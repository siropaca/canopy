//! `.git` の監視を、実物のファイルシステムのイベントで確かめる。
//!
//! **単体テストでは「届くこと」が分からない。** パスの振り分けとまとめ方は
//! `watch.rs` 側で縛ってあるので、ここで見るのは次の 2 つ
//! (docs/adr/0022-auto-refresh.md)。
//!
//! - ターミナルでのコミットが `.git` の変化として届く
//! - macOS が返すパス (`/private/var/...`) と、登録してある common_dir が噛み合う

mod support;

use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use canopy_lib::watch::{Batch, Target, changed};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use support::Fixture;

/// 届くのを待つ上限。FSEvents は数十 ms 遅れて届く。**落ちるときは早く落とさない。**
const LIMIT: Duration = Duration::from_secs(10);

/// 届かないことを確かめるときの上限。
///
/// まとめの上限 (`MAX_WAIT` = 2 秒) より長くする。それより短いと、
/// 出るはずのものを「出なかった」と数えてしまう。
const QUIET_LIMIT: Duration = Duration::from_secs(3);

/// Watch `common_dir` and hand back the paths as they arrive.
fn watch(common_dir: &Path) -> (RecommendedWatcher, Receiver<Vec<PathBuf>>) {
    let (sender, receiver) = channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            // 受け側が消えていたら落とす
            drop(sender.send(event.paths));
        }
    })
    .expect("the watcher should start");
    watcher
        .watch(common_dir, RecursiveMode::Recursive)
        .expect("the common dir should be watchable");
    (watcher, receiver)
}

/// Fold what arrives until the batch is due, or the limit runs out.
///
/// **溜まらないまま時間切れになったら空を返す。** 「2 回目が来ないこと」を
/// 見るのにも使う。
fn collect(receiver: &Receiver<Vec<PathBuf>>, targets: &[Target]) -> Vec<String> {
    collect_within(receiver, targets, LIMIT)
}

fn collect_within(
    receiver: &Receiver<Vec<PathBuf>>,
    targets: &[Target],
    limit: Duration,
) -> Vec<String> {
    let mut batch = Batch::default();
    let deadline = Instant::now() + limit;
    while Instant::now() < deadline {
        if let Ok(paths) = receiver.recv_timeout(Duration::from_millis(100)) {
            let now = Instant::now();
            for path in paths {
                for target in changed(&path, targets) {
                    batch.note(&target.repo_id, now);
                }
            }
        }
        if batch.due(Instant::now()) {
            break;
        }
    }
    batch.take()
}

/// 実パスに直す。macOS の一時ディレクトリは `/var -> /private/var` の symlink
fn common_dir_of(fixture: &Fixture) -> PathBuf {
    std::fs::canonicalize(fixture.work().join(".git")).expect("the .git directory exists")
}

/// ターミナルでコミットすると、そのリポジトリの変化として届く
#[tokio::test]
async fn sees_a_commit_made_outside_the_app() {
    let fixture = Fixture::new().await;
    let common_dir = common_dir_of(&fixture);
    let targets = vec![Target::new("r1".to_owned(), common_dir.clone())];
    let (_watcher, receiver) = watch(&common_dir);

    fixture.commit("outside.txt").await;

    assert_eq!(
        collect(&receiver, &targets),
        ["r1"],
        "`.git` の変化が届いていない"
    );
}

/// **1 操作で何十ファイルも動くが、出るのは 1 回。**
/// ブランチを 5 本作っても、取り直しの依頼は 1 件にまとまる
///
/// **1 回目を取っただけでは足りない。** `Batch` は集合なので、5 回別々に出ても
/// 1 回目の中身は `["r1"]` になる。**2 回目が来ないこと**まで見る
#[tokio::test]
async fn folds_one_burst_of_changes_into_one_request() {
    let fixture = Fixture::new().await;
    let common_dir = common_dir_of(&fixture);
    let targets = vec![Target::new("r1".to_owned(), common_dir.clone())];
    let (_watcher, receiver) = watch(&common_dir);

    for index in 0..5 {
        fixture
            .work_git(&["branch", &format!("topic-{index}")])
            .await;
    }

    assert_eq!(collect(&receiver, &targets), ["r1"]);
    assert!(
        collect_within(&receiver, &targets, QUIET_LIMIT).is_empty(),
        "同じ 1 操作で 2 回目が出ている"
    );
}
