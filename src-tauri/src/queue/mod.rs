//! Limits on how much git runs at once, and the snapshot generation counter.
//!
//! 方針は docs/adr/0009-concurrency-and-refresh.md。
//! 書き込みのリポジトリごとの直列化はフェーズ 2 でここに足す。
//!
//! **キーが 2 種になるのは意図的。** 世代 (`revision`) はリポジトリ id ごと、
//! フェーズ 2 で足すロックは `--git-common-dir` ごとになる。
//! いまは `Registry::add` が common_dir の重複を弾くので 1:1 だが、
//! リポジトリを移動した後の古い設定ファイルでは崩れ得るので、
//! ロックのキーは id に寄せない (ADR-0009)。

use std::collections::HashMap;

use tokio::sync::{Mutex, Semaphore, SemaphorePermit};

/// How many snapshots may be read at the same time.
///
/// 実測でローカルの読み取りだけで CPU 491% (5 コア飽和) まで行くので、
/// 全部同時に投げない (docs/adr/0009-concurrency-and-refresh.md)。
pub const READ_LIMIT: usize = 4;

/// Concurrency limits and revision numbers, shared by every command.
#[derive(Debug)]
pub struct GitQueue {
    reads: Semaphore,
    revisions: Mutex<HashMap<String, u64>>,
}

impl Default for GitQueue {
    fn default() -> Self {
        Self {
            reads: Semaphore::new(READ_LIMIT),
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

#[cfg(test)]
mod tests {
    use super::*;

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

        let permits: Vec<_> = futures_lite_join(&queue).await;

        assert_eq!(permits.len(), READ_LIMIT);
        assert!(queue.reads.try_acquire().is_err());
        drop(permits);
        assert!(queue.reads.try_acquire().is_ok());
    }

    async fn futures_lite_join(queue: &GitQueue) -> Vec<SemaphorePermit<'_>> {
        let mut permits = Vec::new();
        for _ in 0..READ_LIMIT {
            permits.push(queue.read_permit().await);
        }
        permits
    }
}
