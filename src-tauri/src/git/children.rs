//! Keeping track of the git processes that are still running.
//!
//! `kill_on_drop` は直の子だけを殺す。フェッチを打ち切ると `ssh` が残る (実測)。
//! 子をプロセスグループの先頭にして、グループ単位で畳む
//! (docs/adr/0020-process-group-kill.md)。
//!
//! アプリ終了時にも同じことをする。`kill_on_drop` は future を落としたときだけ
//! 効くので、プロセスが終わる経路では走らない
//! (docs/adr/0009-concurrency-and-refresh.md の「ネットワーク操作の打ち切り」)。

use std::collections::BTreeSet;
use std::sync::Mutex;

use tokio::process::{Child, Command};

/// Put the child in a new process group of its own.
///
/// **グループを作らないと孫が残る。** `git fetch` は `ssh` を起こすので、
/// 直の子だけを殺しても接続待ちの `ssh` が生き続ける。
/// 引数の `0` は「自分の pid をグループ id にする」の意味。
pub fn own_process_group(command: &mut Command) -> &mut Command {
    command.process_group(0)
}

/// Kill the whole process group led by `pgid`, grandchildren included.
///
/// 相手は `own_process_group` を通した子だけ。グループが既に無ければ
/// `killpg` は `ESRCH` を返して何もしない。
fn kill_group(pgid: u32) -> bool {
    // SAFETY: killpg は失敗しても errno を返すだけで、こちらの状態を壊さない。
    // pgid は「まだ `wait` していない子」の pid なので、別のプロセスに
    // 割り当て直されない (docs/adr/0020-process-group-kill.md)
    unsafe { libc::killpg(pgid as libc::pid_t, libc::SIGKILL) == 0 }
}

/// Whether a process with `pid` still exists.
///
/// **`Child` を持っていない孫にしか使えない。** 直の子は kill しても `wait` する
/// までゾンビとして残り、この判定では生きているように見える。
#[cfg(test)]
fn is_alive(pid: u32) -> bool {
    // SAFETY: シグナル 0 は「存在の確認だけ」。プロセスには何も送らない
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

/// The process groups of the git children that are still running.
///
/// テストが自分のインスタンスを作れるように struct にしている。
/// 実行時に使うのは [`running`] が返す 1 個だけ。
pub struct ChildGroups(Mutex<BTreeSet<u32>>);

impl ChildGroups {
    pub const fn new() -> Self {
        Self(Mutex::new(BTreeSet::new()))
    }

    /// Remember a child until its [`Registered`] guard is dropped.
    ///
    /// `None` は既に終わっている子。控える必要が無い。
    pub fn register(&self, pgid: Option<u32>) -> Registered<'_> {
        if let Some(pgid) = pgid {
            self.set().insert(pgid);
        }
        Registered { groups: self, pgid }
    }

    /// Kill every group still registered. Returns how many were **actually** killed.
    ///
    /// **控えは消さない。** 畳んだあとに `wait` した側が自分の分を外す。
    /// 既に終わっているグループは `ESRCH` で数に入らない。控えの数を返すと、
    /// 終了時のログが実際より多く見える。
    pub fn kill_all(&self) -> usize {
        // ロックを持ったまま撃たない。撃つ相手が控えを触ることは無いが、
        // ロックの範囲は短くしておく
        let groups = self.set().clone();
        groups.iter().filter(|pgid| kill_group(**pgid)).count()
    }

    #[cfg(test)]
    pub fn contains(&self, pgid: u32) -> bool {
        self.set().contains(&pgid)
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.set().len()
    }

    /// ロックが毒されていても止まらない。**控えを失っても実行は続けたい**
    fn set(&self) -> std::sync::MutexGuard<'_, BTreeSet<u32>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for ChildGroups {
    fn default() -> Self {
        Self::new()
    }
}

/// Keeps one child in the registry for as long as it is running.
///
/// 早期 return でも外れるように、外すのは `Drop` に置く。
pub struct Registered<'a> {
    groups: &'a ChildGroups,
    pgid: Option<u32>,
}

impl Registered<'_> {
    /// Kill this child's group. 締め切りを過ぎたときに呼ぶ。
    pub fn kill(&self) {
        if let Some(pgid) = self.pgid {
            kill_group(pgid);
        }
    }
}

/// Spawn a child in its own process group and keep it in `groups`.
///
/// **控えを引数で受ける。** グローバルに直結すると、終了時の一括 kill を
/// 試すテストが同時に走っている他のテストの git まで撃つ。
pub fn spawn_in<'a>(
    groups: &'a ChildGroups,
    command: &mut Command,
) -> std::io::Result<(Child, Registered<'a>)> {
    let child = own_process_group(command).spawn()?;
    let guard = groups.register(child.id());
    Ok((child, guard))
}

impl Drop for Registered<'_> {
    fn drop(&mut self) {
        if let Some(pgid) = self.pgid {
            self.groups.set().remove(&pgid);
        }
    }
}

/// The one registry the app uses.
static RUNNING: ChildGroups = ChildGroups::new();

#[cfg(test)]
pub fn running() -> &'static ChildGroups {
    &RUNNING
}

/// Kill every git child that is still running. **アプリ終了時に呼ぶ。**
pub fn kill_running_children() -> usize {
    RUNNING.kill_all()
}

/// Spawn a child in its own process group and keep it in the registry.
///
/// **`run` はこれを通す。** 直に `spawn()` すると、終了時の一括 kill が
/// その子を拾えない。
pub fn spawn_registered(command: &mut Command) -> std::io::Result<(Child, Registered<'static>)> {
    spawn_in(&RUNNING, command)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::process::Stdio;
    use std::time::Duration;

    /// Shell that stays alive until it is killed.
    fn sh(script: &str) -> Command {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command
    }

    /// Wait until `pid` is gone. 消えるまでに少しかかる (親の死後に init が回収する)。
    async fn wait_until_gone(pid: u32) -> bool {
        for _ in 0..200 {
            if !is_alive(pid) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        false
    }

    /// 控えた子はグループごと畳む。**孫も一緒に消える**
    #[tokio::test]
    async fn kills_the_whole_group_including_grandchildren() {
        let groups = ChildGroups::new();
        // 孫を起こして、その pid を出してから親は待つ
        let mut child = own_process_group(&mut sh("sleep 30 & echo $!; wait"))
            .spawn()
            .expect("sh should start");
        let parent = child.id().expect("the child has a pid");
        let grandchild = read_first_line(&mut child).await;
        let guard = groups.register(Some(parent));

        let started = std::time::Instant::now();
        assert_eq!(groups.kill_all(), 1);
        child.wait().await.expect("the killed child is reaped");

        // 撃たなければ `sleep 30` が終わるまで返らない。
        // **親の終了コードは縛らない。** 孫が先に死ぬと `wait` が返って 0 で終わる
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "kill が効いていない ({:?})",
            started.elapsed()
        );
        // **孫はここが本題。** `kill_on_drop` では残る
        assert_ne!(parent, grandchild, "孫の pid を読めていない");
        assert!(wait_until_gone(grandchild).await, "孫が残っている");
        drop(guard);
    }

    /// 既に終わっているグループは数に入らない。
    /// 控えの数を返すと、終了時のログが実際より多く見える
    #[tokio::test]
    async fn counts_only_the_groups_it_could_kill() {
        let groups = ChildGroups::new();
        let mut alive = own_process_group(&mut sh("sleep 30"))
            .spawn()
            .expect("sh should start");
        let alive_guard = groups.register(alive.id());
        // 存在しないグループ。撃っても何も起きない
        let _gone = groups.register(Some(999_999));

        assert_eq!(groups.kill_all(), 1);

        alive.wait().await.expect("the killed child is reaped");
        drop(alive_guard);
    }

    /// 走り終えた子は控えから消える。次の一括 kill が無関係な pid を撃たない
    #[tokio::test]
    async fn forgets_a_child_when_its_guard_is_dropped() {
        let groups = ChildGroups::new();
        let guard = groups.register(Some(4242));

        assert!(groups.contains(4242));
        assert_eq!(groups.len(), 1);

        drop(guard);

        assert!(!groups.contains(4242));
        assert_eq!(groups.len(), 0);
    }

    /// 既に終わっている子 (pid が無い) は控えない
    #[tokio::test]
    async fn ignores_a_child_without_a_pid() {
        let groups = ChildGroups::new();

        let guard = groups.register(None);

        assert_eq!(groups.len(), 0);
        drop(guard);
    }

    /// `spawn_registered` は**共有の**控えに入れる。
    /// アプリ終了時の一括 kill が拾えるのはここに入っている分だけ
    #[tokio::test]
    async fn spawn_registered_uses_the_shared_registry() {
        let (mut child, guard) = spawn_registered(&mut sh("sleep 30")).expect("sh should start");
        let pid = child.id().expect("the child has a pid");

        assert!(running().contains(pid));

        guard.kill();
        drop(guard);

        assert!(!running().contains(pid));
        let status = child.wait().await.expect("the killed child is reaped");
        assert_eq!(status.code(), None, "kill が効いていない");
    }

    /// `Registered::kill` はその 1 本だけを畳む。他の控えは触らない
    #[tokio::test]
    async fn kill_touches_only_its_own_group() {
        let groups = ChildGroups::new();
        let mut victim = own_process_group(&mut sh("sleep 30"))
            .spawn()
            .expect("sh should start");
        let mut bystander = own_process_group(&mut sh("sleep 30"))
            .spawn()
            .expect("sh should start");
        let victim_pid = victim.id().expect("pid");
        let bystander_pid = bystander.id().expect("pid");
        let victim_guard = groups.register(Some(victim_pid));
        let _bystander_guard = groups.register(Some(bystander_pid));

        victim_guard.kill();

        let status = victim.wait().await.expect("the killed child is reaped");
        assert_eq!(status.code(), None, "撃った側が残っている");
        // **撃った直後の `try_wait` では判定できない。** シグナルが届いて終わるまでに
        // 間があるので、待っても終わらないことで「生きている」を見る
        let still_running =
            tokio::time::timeout(Duration::from_millis(500), bystander.wait()).await;
        assert!(still_running.is_err(), "関係ない子まで撃っている");
        bystander.kill().await.expect("clean up");
    }

    /// stdout の 1 行目を読む。孫の pid を受け取るため
    async fn read_first_line(child: &mut Child) -> u32 {
        use tokio::io::AsyncReadExt;
        let mut stdout = child.stdout.take().expect("stdout is piped");
        let mut raw = Vec::new();
        // 孫の pid の行が来るまで読む。改行が来たら止める
        let mut byte = [0u8; 1];
        while stdout.read(&mut byte).await.expect("read") == 1 {
            if byte[0] == b'\n' {
                break;
            }
            raw.push(byte[0]);
        }
        String::from_utf8_lossy(&raw)
            .trim()
            .parse()
            .expect("the script prints the grandchild's pid")
    }
}
