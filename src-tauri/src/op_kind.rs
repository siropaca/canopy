//! What kind of operation is running.
//!
//! **git も queue も同じ名前を要る。** 重複排除のキー (`queue`)、
//! ネットワークの枠の判定 (`ops`)、失敗の文言 (`git::message`) の 3 つが
//! 同じ列挙を見るので、どれにも属さない場所に置く。
//!
//! ここに置かないと `queue` が `git` に依存する。git でない操作
//! (`open` を叩くもの、v2 のコミット) を重複排除に載せたくなったときに、
//! git の文言モジュールへ名前を足すことになる。

use std::time::Duration;

/// How long a fetch or a push may take before it is killed.
///
/// `GIT_SSH_COMMAND` の `ConnectTimeout=5` は接続だけに効く。認証が通ってから
/// 応答が来ない相手には効かないので、全体の締め切りを別に置く
/// (docs/adr/0009-concurrency-and-refresh.md)。
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(30);

/// Ceiling for everything else.
///
/// 大きいリポジトリのチェックアウトや、遅い回線のプルを誤って殺さない長さ。
/// 読み取りには付けない (巨大な `git status` を殺したくない)。
pub const LONG_TIMEOUT: Duration = Duration::from_secs(600);

/// Which operation produced an output.
///
/// **同じ文字列でも操作によって意味が逆になる。** `(non-fast-forward)` は
/// プッシュなら「リモートが進んでいる」、プルなら「手元が進んでいる」。
/// 文言の対応は `git::describe` にある
/// (docs/specs/git-operations.md の「失敗の扱い」)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OpKind {
    /// `git fetch --prune`
    Fetch,
    /// `git pull --rebase` (現在のブランチ)
    Pull,
    /// `git fetch <リモート> <上流>:<名前>` (他のローカルブランチを早送り)
    FastForward,
    /// `git switch`
    Checkout,
    /// `git checkout --detach refs/tags/<名前>`
    CheckoutTag,
    /// `git checkout -`
    Previous,
    /// `git push`
    Push,
    /// `git push --force-with-lease=<名前>:<sha>`
    ForcePush,
    /// `git branch -m`
    Rename,
}

impl OpKind {
    /// Whether this operation talks to a remote. 同時実行の枠が変わる。
    pub fn is_network(self) -> bool {
        matches!(
            self,
            Self::Fetch | Self::Pull | Self::FastForward | Self::Push | Self::ForcePush
        )
    }

    /// How long this operation may take before it is killed.
    ///
    /// **打ち切って良いのはフェッチとプッシュだけ** (docs/adr/0009-concurrency-and-refresh.md)。
    /// `git pull --rebase` は後半が rebase なので、途中で殺すと
    /// `.git/rebase-merge` が残る。v1 に `rebase --abort` の入口が無いので、
    /// アプリからは復帰できなくなる。
    ///
    /// 打ち切らない操作にも天井は持たせる。「付けるか付けないか」の分岐にすると、
    /// 分岐を消しても振る舞いで見分けられない。
    pub fn deadline(self) -> Duration {
        match self {
            Self::Fetch | Self::FastForward | Self::Push | Self::ForcePush => NETWORK_TIMEOUT,
            Self::Pull | Self::Checkout | Self::CheckoutTag | Self::Previous | Self::Rename => {
                LONG_TIMEOUT
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **打ち切るのはフェッチとプッシュだけ。**
    /// プルを打ち切ると rebase の途中で死んで、アプリから復帰できなくなる
    #[test]
    fn only_kills_a_fetch_or_a_push_after_thirty_seconds() {
        for kind in [
            OpKind::Fetch,
            OpKind::FastForward,
            OpKind::Push,
            OpKind::ForcePush,
        ] {
            assert_eq!(kind.deadline(), Duration::from_secs(30), "{kind:?}");
        }
        for kind in [
            OpKind::Pull,
            OpKind::Checkout,
            OpKind::CheckoutTag,
            OpKind::Previous,
            OpKind::Rename,
        ] {
            assert_eq!(kind.deadline(), Duration::from_secs(600), "{kind:?}");
        }
    }

    /// ネットワークを使う操作は同時実行の枠を分ける。**プルも含む**
    #[test]
    fn knows_which_operations_talk_to_a_remote() {
        for kind in [
            OpKind::Fetch,
            OpKind::Pull,
            OpKind::FastForward,
            OpKind::Push,
            OpKind::ForcePush,
        ] {
            assert!(kind.is_network(), "{kind:?}");
        }
        for kind in [
            OpKind::Checkout,
            OpKind::CheckoutTag,
            OpKind::Previous,
            OpKind::Rename,
        ] {
            assert!(!kind.is_network(), "{kind:?}");
        }
    }
}
