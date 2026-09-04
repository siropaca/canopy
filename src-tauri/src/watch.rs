//! Watching each repository's `.git` and telling the frontend what changed.
//!
//! 方針は docs/adr/0022-auto-refresh.md。
//!
//! **見るのは `--git-common-dir` だけ。** ワークツリーの中身は見ない
//! (`node_modules` を抱えるので現実的でない)。リンクされたワークツリーの
//! `HEAD` と `index` は `worktrees/<名前>/` にあるので、common_dir を再帰で
//! 見れば足りる。

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as SyncMutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

/// Event that carries the repositories whose `.git` changed.
///
/// **1 件ずつではなくまとめて送る。** git の 1 操作で `.git` の中の何十ファイルも
/// 動く (docs/adr/0022-auto-refresh.md)。
pub const REPOS_CHANGED: &str = "repos_changed";

/// How long to wait for the changes to stop before telling the frontend.
pub const QUIET: Duration = Duration::from_millis(400);

/// How long a batch may keep growing before it is sent anyway.
///
/// **静穏だけにしない。** 長いフェッチの間じゅう締め切りが後ろへ延びて、
/// 終わるまで 1 回も出なくなる。
pub const MAX_WAIT: Duration = Duration::from_secs(2);

/// How long changes are still ignored after our own operation finished.
///
/// イベントは FSEvents の遅延とまとめの分だけ遅れて届く。操作の終了と同時に
/// 解くと、その操作が起こした変化を拾ってもう一度取り直すことになる。
pub const MUTE_GRACE: Duration = Duration::from_millis(1500);

/// One repository being watched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub repo_id: String,
    /// `git rev-parse --git-common-dir` の実パス。
    pub common_dir: PathBuf,
}

impl Target {
    pub fn new(repo_id: String, common_dir: PathBuf) -> Self {
        Self {
            repo_id,
            common_dir,
        }
    }
}

/// Which repositories should be read again because `path` changed.
///
/// **`objects/` の下と `*.lock` は数えない。** 前者はフェッチ 1 回で数千件
/// 書かれるが、refs が動くまで画面は変わらない。後者は git が本体と対で作るので、
/// 本体の方で拾える。
pub fn changed<'a>(path: &Path, targets: &'a [Target]) -> Vec<&'a Target> {
    targets
        .iter()
        .filter(|target| {
            path.strip_prefix(&target.common_dir)
                .is_ok_and(|inside| !is_noise(inside))
        })
        .collect()
}

/// Whether a path inside `.git` can be ignored.
fn is_noise(inside: &Path) -> bool {
    let is_lock = inside
        .extension()
        .is_some_and(|extension| extension == "lock");
    is_lock || in_object_database(inside)
}

/// Whether the path is inside an object database.
///
/// **サブモジュールの分も見る。** サブモジュールの `.git` は
/// `<common>/modules/<名前>/` に置かれるので、`objects` が先頭とは限らない。
/// 先頭だけを見ていると、サブモジュールのフェッチのたびに取り直しが走る。
///
/// 逆に `refs/heads/objects/x` のような**ブランチ名**は数える。
fn in_object_database(inside: &Path) -> bool {
    let mut parts = inside.components();
    loop {
        let Some(first) = parts.next() else {
            return false;
        };
        if first.as_os_str() == "objects" {
            return true;
        }
        if first.as_os_str() != "modules" {
            return false;
        }
        // `modules/<名前>/` を 1 段はがして、その中を同じ目で見る (入れ子もある)
        if parts.next().is_none() {
            return false;
        }
    }
}

/// Repositories that changed, and when to tell the frontend about them.
///
/// **何件来ても 1 回に畳む。** 溜めておいて、静かになったか、溜め始めてから
/// [`MAX_WAIT`] が過ぎたときに出す。
#[derive(Debug, Default)]
pub struct Batch {
    repos: BTreeSet<String>,
    /// 最初に溜めた時刻。[`MAX_WAIT`] の起点。
    first: Option<Instant>,
    /// 最後に溜めた時刻。[`QUIET`] の起点。
    last: Option<Instant>,
}

impl Batch {
    /// Remember that this repository changed.
    pub fn note(&mut self, repo_id: &str, now: Instant) {
        self.repos.insert(repo_id.to_owned());
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    /// How long until this batch should be sent. 溜まっていなければ `None`。
    pub fn wait(&self, now: Instant) -> Option<Duration> {
        let (first, last) = (self.first?, self.last?);
        let deadline = std::cmp::min(last + QUIET, first + MAX_WAIT);
        Some(deadline.saturating_duration_since(now))
    }

    /// Whether the batch should be sent now.
    pub fn due(&self, now: Instant) -> bool {
        self.wait(now).is_some_and(|left| left.is_zero())
    }

    /// Take what has been collected, and start over.
    pub fn take(&mut self) -> Vec<String> {
        self.first = None;
        self.last = None;
        std::mem::take(&mut self.repos).into_iter().collect()
    }
}

/// Repositories whose changes are ours, and should not be read again.
///
/// 書き込み操作は、そのあと**同じロックの中で**取り直している
/// (docs/adr/0009-concurrency-and-refresh.md)。監視が拾った分をもう一度
/// 走らせると、同じリポジトリの読み取りが 2 倍になる。
///
/// キーは `--git-common-dir`。キューのロックと同じ単位。
#[derive(Debug, Clone, Default)]
pub struct Quiet(Arc<SyncMutex<HashMap<PathBuf, Mute>>>);

#[derive(Debug)]
enum Mute {
    /// 走っている操作の本数。
    Running(usize),
    /// 終わってから、まだ捨てる期限。
    Until(Instant),
}

impl Quiet {
    /// Ignore this repository's changes until the guard is dropped, plus
    /// [`MUTE_GRACE`].
    pub fn mute(&self, key: &Path) -> Muted<'_> {
        let mut muted = self.entries();
        match muted.get_mut(key) {
            Some(Mute::Running(count)) => *count += 1,
            _ => {
                muted.insert(key.to_owned(), Mute::Running(1));
            }
        }
        drop(muted);
        Muted {
            quiet: self,
            key: key.to_owned(),
        }
    }

    /// Whether this repository's changes are ours right now.
    pub fn is_muted(&self, key: &Path, now: Instant) -> bool {
        let mut muted = self.entries();
        match muted.get(key) {
            Some(Mute::Running(_)) => true,
            Some(Mute::Until(deadline)) if *deadline > now => true,
            // 過ぎた覚えは残さない。リポジトリを消しても増え続ける
            Some(_) => {
                muted.remove(key);
                false
            }
            None => false,
        }
    }

    fn release(&self, key: &Path, now: Instant) {
        let mut muted = self.entries();
        let Some(Mute::Running(count)) = muted.get_mut(key) else {
            return;
        };
        *count -= 1;
        if *count == 0 {
            muted.insert(key.to_owned(), Mute::Until(now + MUTE_GRACE));
        }
    }

    /// Drop the mutes whose grace has passed.
    ///
    /// **`is_muted` だけでは落ちないキーがある。** リポジトリをリストから削除すると
    /// そのキーのイベントは二度と来ないので、覚えだけが残る。
    pub fn sweep(&self, now: Instant) {
        self.entries().retain(|_, mute| match mute {
            Mute::Running(_) => true,
            Mute::Until(deadline) => *deadline > now,
        });
    }

    fn entries(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, Mute>> {
        lock(&self.0)
    }
}

/// Holds the mute until it is dropped.
#[derive(Debug)]
pub struct Muted<'a> {
    quiet: &'a Quiet,
    key: PathBuf,
}

impl Drop for Muted<'_> {
    fn drop(&mut self) {
        self.quiet.release(&self.key, Instant::now());
    }
}

/// The OS watcher and what it is watching. Tauri が持つ 1 個。
///
/// **`RepoWatch` を落とすと監視も止まる。** `notify` の watcher は drop で
/// 外れるので、`install` で `manage` に預けたまま持ち続ける。
pub struct RepoWatch {
    watcher: SyncMutex<RecommendedWatcher>,
    targets: Arc<SyncMutex<Vec<Target>>>,
}

impl RepoWatch {
    /// Watch exactly `wanted`, and stop watching everything else.
    ///
    /// **張れなかったものは覚えない。** 覚えると、次に呼ばれたときに
    /// 張り直す機会が無くなる。
    fn apply(&self, wanted: Vec<Target>) {
        let mut watcher = lock(&self.watcher);
        let mut watched = lock(&self.targets);
        let (gone, added) = plan(&watched, &wanted);

        for path in gone {
            if let Err(error) = watcher.unwatch(&path) {
                eprintln!("canopy: {} の監視を外せません: {error}", path.display());
            }
        }
        let mut failed = Vec::new();
        for path in added {
            if let Err(error) = watcher.watch(&path, RecursiveMode::Recursive) {
                // 握りつぶさない。**そのリポジトリだけ自動で更新されなくなる**
                eprintln!("canopy: {} を監視できません: {error}", path.display());
                failed.push(path);
            }
        }
        *watched = wanted
            .into_iter()
            .filter(|target| !failed.contains(&target.common_dir))
            .collect();
    }
}

/// What to stop watching, and what to start watching.
///
/// **変わらないものは張り直さない。** `notify` の macOS 実装は `watch` /
/// `unwatch` のたびにストリーム全体を止めて張り直すので、触る回数をそのまま
/// 取りこぼしの窓の数にしないため (docs/pitfalls.md)。
fn plan(watched: &[Target], wanted: &[Target]) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let missing = |from: &[Target], target: &Target| {
        !from
            .iter()
            .any(|other| other.common_dir == target.common_dir)
    };
    let gone = watched
        .iter()
        .filter(|old| missing(wanted, old))
        .map(|old| old.common_dir.clone())
        .collect();
    let added = wanted
        .iter()
        .filter(|new| missing(watched, new))
        .map(|new| new.common_dir.clone())
        .collect();
    (gone, added)
}

/// Start watching. 対象は [`sync`] で入れる。
///
/// **張れなくても起動は続ける。** 監視が無くても、「更新」と前面復帰の
/// 引き金は残る (docs/adr/0022-auto-refresh.md)。
pub fn install<R: Runtime>(app: &AppHandle<R>, quiet: Quiet) -> notify::Result<()> {
    let (sender, receiver) = unbounded_channel::<Vec<PathBuf>>();
    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        match event {
            // 受け側が消えていたら落とす。終了の途中でしか起きない
            Ok(event) => drop(sender.send(event.paths)),
            // 握りつぶさない。監視が効いていないことに気づけなくなる
            Err(error) => eprintln!("canopy: .git の監視でエラーが出ました: {error}"),
        }
    })?;

    let targets = Arc::new(SyncMutex::new(Vec::new()));
    app.manage(RepoWatch {
        watcher: SyncMutex::new(watcher),
        targets: Arc::clone(&targets),
    });
    let app = app.clone();
    tauri::async_runtime::spawn(pump(receiver, targets, quiet, move |repo_ids| {
        if let Err(error) = app.emit(REPOS_CHANGED, repo_ids) {
            // 送れなかったら画面が更新されないので、黙って捨てない
            eprintln!("canopy: {REPOS_CHANGED} を送れませんでした: {error}");
        }
    }));
    Ok(())
}

/// Watch exactly these repositories. **登録が変わったら呼ぶ。**
pub fn sync<R: Runtime>(app: &AppHandle<R>, wanted: Vec<Target>) {
    let Some(watch) = app.try_state::<RepoWatch>() else {
        // `install` が失敗した。監視だけ無い状態で動く
        return;
    };
    watch.apply(wanted);
}

/// Fold the incoming changes and hand them to `emit`.
///
/// **1 イベント 1 回では出さない。** git の 1 操作で `.git` の中の何十ファイルも
/// 動くので、[`Batch`] に溜めてから出す (docs/adr/0022-auto-refresh.md)。
///
/// **`AppHandle` を受けない。** 受けると、畳み方と握りつぶしを合わせた経路が
/// Tauri 無しでは 1 度も動かせなくなる (docs/testing.md の「配線を見ていない呼び出し」)。
async fn pump(
    mut receiver: UnboundedReceiver<Vec<PathBuf>>,
    targets: Arc<SyncMutex<Vec<Target>>>,
    quiet: Quiet,
    emit: impl Fn(Vec<String>),
) {
    let mut batch = Batch::default();
    loop {
        let received = match batch.wait(Instant::now()) {
            // 溜まっている。出す時機まで受け取り続ける (時間切れなら `None` = 出す番)
            Some(left) => tokio::time::timeout(left, receiver.recv()).await.ok(),
            // 溜まっていない。次のイベントまで寝る
            None => Some(receiver.recv().await),
        };
        // 送り側が落ちた = アプリが終わる。**溜まっている分は出してから止める**
        let closed = matches!(received, Some(None));

        if let Some(Some(paths)) = received {
            let now = Instant::now();
            let watched = lock(&targets);
            for path in paths {
                for target in changed(&path, &watched) {
                    // **自分が走らせた操作の分は数えない。** 取り直しは操作の側が
                    // 既にやっている (docs/adr/0009-concurrency-and-refresh.md)
                    if quiet.is_muted(&target.common_dir, now) {
                        continue;
                    }
                    batch.note(&target.repo_id, now);
                }
            }
        }

        let now = Instant::now();
        if closed || batch.due(now) {
            let repo_ids = batch.take();
            if !repo_ids.is_empty() {
                emit(repo_ids);
            }
            // 届かなくなったキーの覚えは、ここでしか落ちない
            quiet.sweep(now);
        }
        if closed {
            return;
        }
    }
}

/// Take a lock without letting one panic stop every later change.
fn lock<T>(value: &SyncMutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(repo_id: &str, common_dir: &str) -> Target {
        Target::new(repo_id.to_owned(), PathBuf::from(common_dir))
    }

    fn targets() -> Vec<Target> {
        vec![
            target("r1", "/repos/acme-api/.git"),
            target("r2", "/repos/acme-web/.git"),
        ]
    }

    fn ids(found: Vec<&Target>) -> Vec<&str> {
        found.iter().map(|t| t.repo_id.as_str()).collect()
    }

    /// **値そのものを固定する。** 定数どうしで比べると、値が変わっても緑になる。
    /// 根拠は docs/adr/0022-auto-refresh.md の「まとめ方」
    #[test]
    fn pins_the_documented_timings() {
        assert_eq!(QUIET, Duration::from_millis(400));
        assert_eq!(MAX_WAIT, Duration::from_secs(2));
        assert_eq!(MUTE_GRACE, Duration::from_millis(1500));
    }

    /// `.git` の下の変化は、そのリポジトリのものとして数える
    #[test]
    fn maps_a_path_to_the_repository_it_belongs_to() {
        let watched = targets();

        assert_eq!(
            ids(changed(
                Path::new("/repos/acme-api/.git/refs/heads/main"),
                &watched
            )),
            ["r1"]
        );
        assert_eq!(
            ids(changed(Path::new("/repos/acme-web/.git/HEAD"), &watched)),
            ["r2"]
        );
    }

    /// リンクされたワークツリーの `HEAD` は common_dir の下にある
    #[test]
    fn counts_linked_worktrees() {
        assert_eq!(
            ids(changed(
                Path::new("/repos/acme-api/.git/worktrees/hotfix/HEAD"),
                &targets()
            )),
            ["r1"]
        );
    }

    /// 監視していない場所は数えない
    #[test]
    fn ignores_paths_outside_every_repository() {
        assert!(changed(Path::new("/repos/other/.git/HEAD"), &targets()).is_empty());
        assert!(changed(Path::new("/repos/acme-api/src/main.rs"), &targets()).is_empty());
    }

    /// フェッチ 1 回で数千件書かれる。refs が動くまで画面は変わらない
    #[test]
    fn ignores_the_object_database() {
        let watched = targets();

        assert!(
            changed(
                Path::new("/repos/acme-api/.git/objects/pack/pack-abc.idx"),
                &watched
            )
            .is_empty()
        );
        assert!(changed(Path::new("/repos/acme-api/.git/objects"), &watched).is_empty());
        // `objects` は先頭のときだけ。ブランチ名に入っていても数える
        assert_eq!(
            ids(changed(
                Path::new("/repos/acme-api/.git/refs/heads/objects/x"),
                &watched
            )),
            ["r1"]
        );
    }

    /// サブモジュールの `.git` は `modules/<名前>/` にある。
    /// **その中の `objects/` も数えない。** フェッチのたびに取り直しが走る
    #[test]
    fn ignores_the_object_database_of_a_submodule() {
        let watched = targets();

        assert!(
            changed(
                Path::new("/repos/acme-api/.git/modules/sub/objects/pack/pack-abc.idx"),
                &watched
            )
            .is_empty()
        );
        assert!(
            changed(
                Path::new("/repos/acme-api/.git/modules/outer/modules/inner/objects/ab/cd"),
                &watched
            )
            .is_empty(),
            "入れ子のサブモジュールも同じ"
        );
        // ref と index は画面に出るので数える
        assert_eq!(
            ids(changed(
                Path::new("/repos/acme-api/.git/modules/sub/HEAD"),
                &watched
            )),
            ["r1"]
        );
    }

    /// git が本体と対で作る。本体の方で拾える
    #[test]
    fn ignores_lock_files() {
        let watched = targets();

        assert!(changed(Path::new("/repos/acme-api/.git/index.lock"), &watched).is_empty());
        assert!(changed(Path::new("/repos/acme-api/.git/packed-refs.lock"), &watched).is_empty());
        assert_eq!(
            ids(changed(Path::new("/repos/acme-api/.git/index"), &watched)),
            ["r1"]
        );
    }

    /// **何件来ても 1 回に畳む。** git の 1 操作で `.git` の中の何十ファイルも動く
    #[test]
    fn folds_many_changes_into_one() {
        let start = Instant::now();
        let mut batch = Batch::default();

        for step in 0..50 {
            batch.note("r1", start + Duration::from_millis(step));
        }

        assert!(
            !batch.due(start + Duration::from_millis(48) + QUIET),
            "最後の 1 件から静穏が経っていないのに出している"
        );
        assert!(batch.due(start + Duration::from_millis(49) + QUIET));
        assert_eq!(batch.take(), ["r1"]);
    }

    /// 別のリポジトリは 1 回の中に並べて出す
    #[test]
    fn keeps_every_repository_that_changed() {
        let start = Instant::now();
        let mut batch = Batch::default();

        batch.note("r2", start);
        batch.note("r1", start);
        batch.note("r2", start);

        assert_eq!(batch.take(), ["r1", "r2"]);
    }

    /// 静かになるまで出さない。1 件ずつ出すと、そのたびに全部の git が走る
    #[test]
    fn waits_until_the_changes_stop() {
        let start = Instant::now();
        let mut batch = Batch::default();
        batch.note("r1", start);

        assert!(!batch.due(start + Duration::from_millis(399)));
        assert!(batch.due(start + Duration::from_millis(400)));
    }

    /// **締め切りは新しい変化のたびに後ろへ延びる。**
    /// 起点が「最初のイベント」だと、変化が続いている途中で出てしまう
    #[test]
    fn pushes_the_deadline_back_on_every_change() {
        let start = Instant::now();
        let mut batch = Batch::default();

        batch.note("r1", start);
        batch.note("r1", start + Duration::from_millis(300));

        assert!(
            !batch.due(start + Duration::from_millis(400)),
            "最初のイベントから 400ms で出てしまっている"
        );
        assert!(!batch.due(start + Duration::from_millis(699)));
        assert!(batch.due(start + Duration::from_millis(700)), "300 + 400");
    }

    /// 静かにならなくても、溜め始めてから [`MAX_WAIT`] で出す。
    /// **これが無いと、長いフェッチの間じゅう 1 回も出ない**
    #[test]
    fn sends_anyway_after_the_longest_wait() {
        let start = Instant::now();
        let mut batch = Batch::default();

        // 300ms ごとに来続ける。静穏 (400ms) には一度も入らない
        for step in 0..10 {
            batch.note("r1", start + Duration::from_millis(step * 300));
        }

        assert!(batch.due(start + MAX_WAIT));
        assert_eq!(batch.take(), ["r1"]);
    }

    /// 出したら空になる。同じ変化を 2 回出さない
    #[test]
    fn starts_over_after_sending() {
        let start = Instant::now();
        let mut batch = Batch::default();
        batch.note("r1", start);
        batch.take();

        assert_eq!(batch.wait(start), None);
        assert!(!batch.due(start + MAX_WAIT * 10));
        assert!(batch.take().is_empty());
    }

    /// 溜まっていない間は待たせない (呼ぶ側は次のイベントまで寝る)
    #[test]
    fn has_nothing_to_wait_for_when_empty() {
        assert_eq!(Batch::default().wait(Instant::now()), None);
    }

    /// **`is_muted` を呼ばれないキーも落とす。** リポジトリを消すと、
    /// そのキーのイベントは二度と来ない
    #[test]
    fn sweeps_the_mutes_nobody_asks_about() {
        let quiet = Quiet::default();
        let gone = Path::new("/repos/acme-api/.git");
        let held = quiet.mute(Path::new("/repos/acme-web/.git"));
        drop(quiet.mute(gone));

        quiet.sweep(Instant::now() + MUTE_GRACE * 2);

        assert!(!quiet.is_muted(gone, Instant::now()), "覚えが残っている");
        assert_eq!(quiet.entries().len(), 1, "走っている分まで落としている");
        drop(held);
    }

    /// 増えた分だけ張って、減った分だけ外す
    #[test]
    fn watches_what_changed_in_the_registration() {
        let watched = vec![
            target("r1", "/repos/acme-api/.git"),
            target("r2", "/repos/acme-web/.git"),
        ];
        let wanted = vec![
            target("r1", "/repos/acme-api/.git"),
            target("r3", "/repos/acme-cli/.git"),
        ];

        let (gone, added) = plan(&watched, &wanted);

        assert_eq!(gone, [PathBuf::from("/repos/acme-web/.git")]);
        assert_eq!(added, [PathBuf::from("/repos/acme-cli/.git")]);
    }

    /// **張り直さない。** 外して張り直すと、その隙間の変化を取りこぼす
    #[test]
    fn leaves_the_unchanged_repositories_alone() {
        let watched = targets();

        let (gone, added) = plan(&watched, &targets());

        assert!(gone.is_empty(), "外している: {gone:?}");
        assert!(added.is_empty(), "張り直している: {added:?}");
    }

    /// 全部消したら全部外す
    #[test]
    fn stops_watching_when_nothing_is_registered() {
        let (gone, added) = plan(&targets(), &[]);

        assert_eq!(
            gone,
            [
                PathBuf::from("/repos/acme-api/.git"),
                PathBuf::from("/repos/acme-web/.git"),
            ]
        );
        assert!(added.is_empty());
    }

    /// 自分が走らせている操作の間は数えない
    #[test]
    fn ignores_changes_while_we_are_writing() {
        let quiet = Quiet::default();
        let key = Path::new("/repos/acme-api/.git");
        let now = Instant::now();

        let running = quiet.mute(key);

        assert!(quiet.is_muted(key, now));
        assert!(
            !quiet.is_muted(Path::new("/repos/acme-web/.git"), now),
            "別のリポジトリまで止めない"
        );
        drop(running);
    }

    /// 終わってからも [`MUTE_GRACE`] の間は数えない。
    /// **イベントは遅れて届く。** 同時に解くと、自分の操作の分を拾う
    #[test]
    fn keeps_ignoring_for_a_while_after_the_operation() {
        let quiet = Quiet::default();
        let key = Path::new("/repos/acme-api/.git");

        drop(quiet.mute(key));
        let after = Instant::now();

        assert!(quiet.is_muted(key, after + Duration::from_millis(1400)));
        assert!(!quiet.is_muted(key, after + Duration::from_millis(1600)));
    }

    /// 2 本重なっても、両方終わるまで解かない
    #[test]
    fn stays_muted_until_the_last_operation_finishes() {
        let quiet = Quiet::default();
        let key = Path::new("/repos/acme-api/.git");

        let first = quiet.mute(key);
        let second = quiet.mute(key);
        drop(first);

        assert!(quiet.is_muted(key, Instant::now() + MUTE_GRACE * 2));
        drop(second);
    }

    /// 過ぎた覚えは残さない。溜め続けると、消したリポジトリの分も増える
    #[test]
    fn forgets_an_expired_mute() {
        let quiet = Quiet::default();
        let key = Path::new("/repos/acme-api/.git");
        drop(quiet.mute(key));

        assert!(!quiet.is_muted(key, Instant::now() + MUTE_GRACE * 2));

        assert!(quiet.entries().is_empty(), "覚えが残っている");
    }
}

#[cfg(test)]
mod pump_tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    fn targets() -> Arc<SyncMutex<Vec<Target>>> {
        Arc::new(SyncMutex::new(vec![
            Target::new("r1".to_owned(), PathBuf::from("/repos/acme-api/.git")),
            Target::new("r2".to_owned(), PathBuf::from("/repos/acme-web/.git")),
        ]))
    }

    /// Feed `paths` through the real loop and collect what it hands to `emit`.
    ///
    /// 送り側を閉じるので、溜まっている分を出して止まる。
    async fn run(paths: Vec<Vec<&str>>, quiet: &Quiet) -> Vec<Vec<String>> {
        let (sender, receiver) = unbounded_channel();
        for batch in paths {
            sender
                .send(batch.into_iter().map(PathBuf::from).collect())
                .expect("the receiver is alive");
        }
        drop(sender);

        let sent = Arc::new(SyncMutex::new(Vec::new()));
        let collect = Arc::clone(&sent);
        pump(receiver, targets(), quiet.clone(), move |repo_ids| {
            lock(&collect).push(repo_ids);
        })
        .await;
        lock(&sent).clone()
    }

    /// **何件来ても 1 回。** 別のリポジトリは同じ 1 回の中に並べる
    #[tokio::test]
    async fn sends_one_request_for_a_burst_of_changes() {
        let quiet = Quiet::default();

        let sent = run(
            vec![
                vec!["/repos/acme-api/.git/refs/heads/main"],
                vec![
                    "/repos/acme-api/.git/index",
                    "/repos/acme-web/.git/refs/heads/develop",
                ],
                vec!["/repos/acme-api/.git/logs/HEAD"],
            ],
            &quiet,
        )
        .await;

        assert_eq!(sent, vec![vec!["r1".to_owned(), "r2".to_owned()]]);
    }

    /// **自分が走らせた操作の分は出さない。** 取り直しは操作の側がやっている
    #[tokio::test]
    async fn drops_the_changes_we_caused_ourselves() {
        let quiet = Quiet::default();
        let running = quiet.mute(Path::new("/repos/acme-api/.git"));

        let sent = run(
            vec![vec![
                "/repos/acme-api/.git/refs/heads/main",
                "/repos/acme-web/.git/refs/heads/develop",
            ]],
            &quiet,
        )
        .await;

        assert_eq!(sent, vec![vec!["r2".to_owned()]], "黙らせた分が出ている");
        drop(running);
    }

    /// 数えない変化しか来なければ、1 回も出さない
    #[tokio::test]
    async fn stays_silent_when_only_noise_arrives() {
        let quiet = Quiet::default();

        let sent = run(
            vec![vec![
                "/repos/acme-api/.git/objects/pack/pack-abc.idx",
                "/repos/acme-api/.git/index.lock",
                "/repos/other/.git/refs/heads/main",
            ]],
            &quiet,
        )
        .await;

        assert!(sent.is_empty(), "{sent:?}");
    }
}
