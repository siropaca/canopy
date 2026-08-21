//! Limits on how much git runs at once, the per-repository lock, and the
//! snapshot generation counter.
//!
//! 方針は docs/adr/0009-concurrency-and-refresh.md。
//!
//! **キーが 2 種になるのは意図的。** 世代 (`revision`) はリポジトリ id ごと、
//! ロックと重複排除は `--git-common-dir` ごと。
//! いまは `Registry::add` が common_dir の重複を弾くので 1:1 だが、
//! リポジトリを移動した後の古い設定ファイルでは崩れ得るので、
//! ロックのキーは id に寄せない (ADR-0009)。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as SyncMutex};

use tokio::sync::{
    Mutex, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock, Semaphore, SemaphorePermit,
};

use crate::op_kind::OpKind;

/// How many snapshots may be read at the same time.
///
/// 実測でローカルの読み取りだけで CPU 491% (5 コア飽和) まで行くので、
/// 全部同時に投げない (docs/adr/0009-concurrency-and-refresh.md)。
pub const READ_LIMIT: usize = 4;

/// How many network operations may run at the same time.
pub const NETWORK_LIMIT: usize = 4;

/// How many repositories a bulk fetch may work on at the same time.
///
/// **ネットワークの上限より小さくする。** 対話操作の枠を空けておかないと、
/// 一括フェッチ中に押したプッシュが最後まで待たされる
/// (docs/adr/0009-concurrency-and-refresh.md)。
pub const BULK_LIMIT: usize = NETWORK_LIMIT - 1;

/// Concurrency limits, per-repository locks and revision numbers.
#[derive(Debug)]
pub struct GitQueue {
    reads: Semaphore,
    network: Semaphore,
    bulk: Semaphore,
    /// 1 リポジトリ (`--git-common-dir`) につき 1 本。
    ///
    /// **書き込み排他・読み取り共有。** `GIT_OPTIONAL_LOCKS=0` はロックの競合を
    /// 避けるだけで内容の整合性は守らないので、フェッチが refs を書き換えている
    /// 途中で `for-each-ref` を読ませない (ADR-0009 の「排他の粒度」)。
    locks: Mutex<HashMap<PathBuf, Arc<RwLock<()>>>>,
    /// いま走っている (リポジトリ, 操作) の組。同種操作の重複排除に使う。
    ///
    /// `Drop` から外すので同期の Mutex にする。await を挟まないので詰まらない。
    running: SyncMutex<HashSet<(PathBuf, OpKind)>>,
    revisions: Mutex<HashMap<String, u64>>,
}

impl Default for GitQueue {
    fn default() -> Self {
        Self {
            reads: Semaphore::new(READ_LIMIT),
            network: Semaphore::new(NETWORK_LIMIT),
            bulk: Semaphore::new(BULK_LIMIT),
            locks: Mutex::new(HashMap::new()),
            running: SyncMutex::new(HashSet::new()),
            revisions: Mutex::new(HashMap::new()),
        }
    }
}

impl GitQueue {
    /// Wait for a slot to read a snapshot.
    pub async fn read_permit(&self) -> SemaphorePermit<'_> {
        self.reads
            .acquire()
            .await
            .expect("the read semaphore is never closed")
    }

    /// Wait for a slot to talk to a remote.
    ///
    /// 読み取りと別の枠にする。一括フェッチで読み取りの枠を食い潰さない。
    pub async fn network_permit(&self) -> SemaphorePermit<'_> {
        self.network
            .acquire()
            .await
            .expect("the network semaphore is never closed")
    }

    /// Wait for a slot in the bulk fetch.
    ///
    /// ネットワークの枠に**加えて**取る。一括フェッチが全部の枠を埋めない。
    pub async fn bulk_permit(&self) -> SemaphorePermit<'_> {
        self.bulk
            .acquire()
            .await
            .expect("the bulk semaphore is never closed")
    }

    /// Enter the serial section for writing to one repository.
    pub async fn write_lock(&self, key: &Path) -> OwnedRwLockWriteGuard<()> {
        self.lock_of(key).await.write_owned().await
    }

    /// Enter the shared section for reading one repository.
    ///
    /// 読み取り同士は並列でよい。**書き込み中の読み取りだけ待たせる。**
    pub async fn read_lock(&self, key: &Path) -> OwnedRwLockReadGuard<()> {
        self.lock_of(key).await.read_owned().await
    }

    async fn lock_of(&self, key: &Path) -> Arc<RwLock<()>> {
        let mut locks = self.locks.lock().await;
        Arc::clone(
            locks
                .entry(key.to_owned())
                .or_insert_with(|| Arc::new(RwLock::new(()))),
        )
    }

    /// Claim `kind` for `key`, unless the same operation is already running.
    ///
    /// フェッチを連打しても 11 本積まれないようにする
    /// (docs/adr/0009-concurrency-and-refresh.md)。
    pub fn try_claim(&self, key: &Path, kind: OpKind) -> Option<Claim<'_>> {
        let entry = (key.to_owned(), kind);
        let mut running = self
            .running
            .lock()
            .expect("the running set is never poisoned");
        if !running.insert(entry.clone()) {
            return None;
        }
        Some(Claim {
            queue: self,
            entry: Some(entry),
        })
    }

    /// Next generation for this repository's snapshot.
    ///
    /// フロントは自分が持っているものより古い `revision` を捨てる。
    /// invoke の解決順は発行順と一致しないので、番号が無いと古い値が新しい値を
    /// 上書きし得る (docs/adr/0009-concurrency-and-refresh.md)。
    pub async fn next_revision(&self, repo_id: &str) -> u64 {
        let mut revisions = self.revisions.lock().await;
        let next = revisions.get(repo_id).copied().unwrap_or(0) + 1;
        revisions.insert(repo_id.to_owned(), next);
        next
    }
}

/// Holds a `(repository, operation)` claim until it is dropped.
#[derive(Debug)]
pub struct Claim<'a> {
    queue: &'a GitQueue,
    /// `Drop` で取り出すので `Option`。
    entry: Option<(PathBuf, OpKind)>,
}

impl Drop for Claim<'_> {
    fn drop(&mut self) {
        if let Some(entry) = self.entry.take() {
            // 詰まらせるより漏らさない。ここで panic すると二重 panic になる
            if let Ok(mut running) = self.queue.running.lock() {
                running.remove(&entry);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(name: &str) -> PathBuf {
        PathBuf::from(format!("/repos/{name}/.git"))
    }

    /// **上限の値そのものを固定する。** 定数どうしで比べると、値が変わっても緑になる。
    /// 根拠は docs/adr/0009-concurrency-and-refresh.md の表 (実測で CPU 491%)
    #[test]
    fn pins_the_documented_limits() {
        assert_eq!(READ_LIMIT, 4);
        assert_eq!(NETWORK_LIMIT, 4);
        assert_eq!(BULK_LIMIT, 3, "対話操作の枠を 1 つ残す");
    }

    /// 世代はリポジトリごとに 1 から増える
    #[tokio::test]
    async fn counts_revisions_per_repository() {
        let queue = GitQueue::default();

        assert_eq!(queue.next_revision("r1").await, 1);
        assert_eq!(queue.next_revision("r1").await, 2);
        assert_eq!(queue.next_revision("r2").await, 1);
        assert_eq!(queue.next_revision("r1").await, 3);
    }

    /// 読み取りの同時実行は 4 まで。5 本目は待つ
    #[tokio::test]
    async fn allows_four_reads_at_once() {
        let queue = GitQueue::default();

        let mut permits = Vec::new();
        for _ in 0..READ_LIMIT {
            permits.push(queue.read_permit().await);
        }

        assert_eq!(permits.len(), READ_LIMIT);
        assert!(queue.reads.try_acquire().is_err());
        drop(permits);
        assert!(queue.reads.try_acquire().is_ok());
    }

    /// ネットワークの枠は読み取りと別。一括フェッチで対話操作を止めない
    #[tokio::test]
    async fn keeps_the_network_slots_apart_from_the_read_slots() {
        let queue = GitQueue::default();

        let mut network = Vec::new();
        for _ in 0..NETWORK_LIMIT {
            network.push(queue.network_permit().await);
        }

        assert!(queue.network.try_acquire().is_err());
        assert!(
            queue.reads.try_acquire().is_ok(),
            "ネットワークが埋まっていても読み取りは通る"
        );
    }

    /// 一括フェッチは枠を全部埋めない。対話操作の分を残す
    #[tokio::test]
    async fn leaves_a_network_slot_for_interactive_operations() {
        let queue = GitQueue::default();

        let mut bulk = Vec::new();
        for _ in 0..BULK_LIMIT {
            bulk.push((queue.bulk_permit().await, queue.network_permit().await));
        }

        assert!(queue.bulk.try_acquire().is_err(), "一括フェッチは打ち止め");
        assert!(
            queue.network.try_acquire().is_ok(),
            "対話操作のネットワークの枠は残っている"
        );
        const { assert!(BULK_LIMIT < NETWORK_LIMIT) };
    }

    /// 同一リポジトリの書き込みは直列になる
    #[tokio::test]
    async fn serialises_writes_to_the_same_repository() {
        let queue = GitQueue::default();
        let held = queue.write_lock(&key("a")).await;

        let second = queue.lock_of(&key("a")).await;
        assert!(second.try_write().is_err(), "2 本目は待たされる");
        drop(held);
        assert!(second.try_write().is_ok());
    }

    /// 異なるリポジトリの書き込みは並列に走る。
    ///
    /// **締め切りで包む。** キーが効かなくなると 2 本目が永久に待つので、
    /// assert が落ちるのではなくテストバイナリが止まる
    #[tokio::test]
    async fn lets_different_repositories_write_at_the_same_time() {
        let queue = GitQueue::default();

        let first = queue.write_lock(&key("a")).await;
        let second = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            queue.write_lock(&key("b")),
        )
        .await
        .expect("別のリポジトリはロックのキーが違うので待たされない");

        drop((first, second));
    }

    /// 読み取り同士は並列。**書き込み中の読み取りだけ待たせる**
    #[tokio::test]
    async fn shares_the_lock_between_readers_but_not_with_a_writer() {
        let queue = GitQueue::default();

        let first = queue.read_lock(&key("a")).await;
        let second = queue.read_lock(&key("a")).await;
        let lock = queue.lock_of(&key("a")).await;
        assert!(lock.try_write().is_err(), "読み取り中は書き込めない");
        drop((first, second));

        let writing = queue.write_lock(&key("a")).await;
        assert!(lock.try_read().is_err(), "書き込み中は読めない");
        drop(writing);
    }

    /// 投入した順に、**重ならずに**実行される。
    ///
    /// 順番だけを見ると、ロックが無くてもタスクは投入順に完走してしまう。
    /// 入りと出をログに残して、区間が入れ子にならないことまで見る
    #[tokio::test]
    async fn runs_operations_in_order_without_overlapping() {
        let queue = Arc::new(GitQueue::default());
        let log = Arc::new(SyncMutex::new(Vec::new()));
        let held = queue.write_lock(&key("a")).await;

        let mut handles = Vec::new();
        for index in 0..5 {
            let queue = Arc::clone(&queue);
            let log = Arc::clone(&log);
            handles.push(tokio::spawn(async move {
                let guard = queue.write_lock(&key("a")).await;
                log.lock().expect("the log is never poisoned").push(index);
                // ロックを持ったまま他のタスクへ譲る。直列なら誰も入れない
                for _ in 0..3 {
                    tokio::task::yield_now().await;
                }
                log.lock().expect("the log is never poisoned").push(index);
                drop(guard);
            }));
            for _ in 0..3 {
                tokio::task::yield_now().await;
            }
        }
        drop(held);
        for handle in handles {
            handle.await.expect("each waiter finishes");
        }

        // 入りと出が対で並ぶ = 区間が重なっていない
        assert_eq!(
            *log.lock().expect("the log is never poisoned"),
            vec![0, 0, 1, 1, 2, 2, 3, 3, 4, 4]
        );
    }

    /// 同種操作は 1 本しか通さない。**フェッチ連打で 11 本積まれない**
    #[tokio::test]
    async fn refuses_a_second_claim_for_the_same_operation() {
        let queue = GitQueue::default();

        let first = queue.try_claim(&key("a"), OpKind::Fetch);
        assert!(first.is_some());
        assert!(
            queue.try_claim(&key("a"), OpKind::Fetch).is_none(),
            "同じリポジトリの同じ操作は 2 本目を通さない"
        );
        assert!(
            queue.try_claim(&key("a"), OpKind::Pull).is_some(),
            "別の操作は通す"
        );
        assert!(
            queue.try_claim(&key("b"), OpKind::Fetch).is_some(),
            "別のリポジトリは通す"
        );

        drop(first);
        assert!(
            queue.try_claim(&key("a"), OpKind::Fetch).is_some(),
            "終わったら次を通す"
        );
    }
}
