use super::run::GitOutput;
use crate::op_kind::OpKind;

/// Wording for a failure we have no specific message for.
///
/// 「失敗しました」で終わらせず、何が失敗したかは必ず出す
/// (docs/specs/git-operations.md の「失敗の扱い」)。
fn generic(kind: OpKind) -> &'static str {
    match kind {
        OpKind::Fetch => "フェッチに失敗しました",
        OpKind::Pull | OpKind::FastForward => "プルに失敗しました",
        OpKind::Checkout | OpKind::CheckoutTag | OpKind::Previous => "チェックアウトに失敗しました",
        OpKind::Push => "プッシュに失敗しました",
        OpKind::ForcePush => "強制プッシュに失敗しました",
        OpKind::Rename => "名前の変更に失敗しました",
    }
}

/// The one line to show a person when an operation failed.
///
/// 判定は「実行した操作の種別 × 出力」で行う。文言の一覧は
/// docs/specs/git-operations.md の「失敗の扱い」にある。
pub fn describe(kind: OpKind, output: &GitOutput) -> String {
    if output.timed_out {
        let seconds = kind.deadline().as_secs();
        // 秒数は操作の種別で違う。固定で書くと嘘になる
        return if kind.is_network() {
            format!("リモートの応答がありません ({seconds} 秒で打ち切りました)")
        } else {
            format!("応答がありません ({seconds} 秒で打ち切りました)")
        };
    }

    let text = format!("{}\n{}", output.stderr, output.stdout);

    // **認証と接続の判定はネットワーク操作に閉じる。**
    // `Permission denied` はローカルの権限エラーにも当たる
    // (`Unable to create '.git/index.lock': Permission denied`)。
    // どの操作でも認証扱いにすると、原因が権限なのに SSH 鍵を疑うことになる
    if kind.is_network() {
        if text.contains("Authentication failed") || text.contains("Permission denied") {
            return "認証に失敗しました".to_owned();
        }
        if text.contains("Could not resolve host") || text.contains("Could not read from remote") {
            return "リモートに接続できませんでした".to_owned();
        }
    }
    if text.contains("unable to update local ref") {
        return "同じリポジトリを二重に登録している可能性があります".to_owned();
    }
    if let Some(path) = worktree_in_use(&text) {
        return format!("別のワークツリーで使用中です ({path})");
    }
    if text.contains("CONFLICT") {
        return "競合しました。手元で解決してください".to_owned();
    }
    if text.contains("would be overwritten") {
        return "チェックアウトできません (変更が上書きされます)".to_owned();
    }
    if text.contains("couldn't find remote ref") {
        return "追跡先が存在しません".to_owned();
    }
    if text.contains("refusing to fetch into branch") {
        return "そのブランチは別のワークツリーにあります".to_owned();
    }
    if text.contains("You are not currently on a branch") {
        return "ブランチ上にいません".to_owned();
    }
    if text.contains("cannot pull with rebase") {
        return "プルに失敗しました (未コミットの変更あり)".to_owned();
    }
    if text.contains("stale info") {
        return "リモートが更新されています。フェッチしてやり直してください".to_owned();
    }
    // **ここから下は操作の種別で意味が変わる**
    //
    // git は同じ拒否を 2 通りの文言で出す。フェッチ済みなら `(non-fast-forward)`、
    // まだフェッチしていなければ `(fetch first)` (実測)。どちらも同じ意味
    if text.contains("non-fast-forward") || text.contains("fetch first") {
        return match kind {
            OpKind::Push | OpKind::ForcePush => {
                "プッシュが拒否されました (リモートが先に進んでいます)".to_owned()
            }
            _ => "早送りできません (手元にコミットがあります)".to_owned(),
        };
    }

    generic(kind).to_owned()
}

/// The worktree path in `'<名前>' is already used by worktree at '<パス>'`.
fn worktree_in_use(text: &str) -> Option<&str> {
    let after = text.split_once("already used by worktree at")?.1;
    let opened = after.find('\'')? + 1;
    let rest = &after[opened..];
    let closed = rest.find('\'')?;
    Some(&rest[..closed])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn failed(stderr: &str) -> GitOutput {
        GitOutput {
            command: "git push origin main".to_owned(),
            code: Some(1),
            stdout: String::new(),
            stderr: stderr.to_owned(),
            timed_out: false,
        }
    }

    /// フェッチしていないときの拒否は `(fetch first)` になる (実測)。
    /// `(non-fast-forward)` だけを見ると「失敗しました」で終わる
    #[test]
    fn reads_the_other_wording_of_the_same_rejection() {
        let output = failed(
            " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs\n",
        );

        assert_eq!(
            describe(OpKind::Push, &output),
            "プッシュが拒否されました (リモートが先に進んでいます)"
        );
    }

    /// **同じ出力が操作で逆の意味になる。** ここを取り違えると、
    /// プルしたのに「プッシュが拒否されました」と出る
    #[test]
    fn reads_non_fast_forward_by_operation() {
        let output = failed(
            " ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs\n",
        );

        assert_eq!(
            describe(OpKind::Push, &output),
            "プッシュが拒否されました (リモートが先に進んでいます)"
        );
        assert_eq!(
            describe(OpKind::ForcePush, &output),
            "プッシュが拒否されました (リモートが先に進んでいます)"
        );
        assert_eq!(
            describe(OpKind::FastForward, &output),
            "早送りできません (手元にコミットがあります)"
        );
        assert_eq!(
            describe(OpKind::Pull, &output),
            "早送りできません (手元にコミットがあります)"
        );
    }

    /// docs/specs/git-operations.md の「失敗の扱い」の表と 1 対 1 で合わせる
    #[test]
    fn matches_the_table_of_common_failures() {
        let cases: [(OpKind, &str, &str); 12] = [
            (
                OpKind::Pull,
                "error: cannot pull with rebase: You have unstaged changes.",
                "プルに失敗しました (未コミットの変更あり)",
            ),
            (
                OpKind::ForcePush,
                " ! [rejected]        main -> main (stale info)",
                "リモートが更新されています。フェッチしてやり直してください",
            ),
            (
                OpKind::FastForward,
                "fatal: refusing to fetch into branch 'refs/heads/main' checked out at '/wt'",
                "そのブランチは別のワークツリーにあります",
            ),
            (
                OpKind::FastForward,
                "fatal: couldn't find remote ref develop",
                "追跡先が存在しません",
            ),
            (
                OpKind::Pull,
                "You are not currently on a branch.",
                "ブランチ上にいません",
            ),
            (
                OpKind::Fetch,
                "error: cannot lock ref 'refs/remotes/origin/main': unable to update local ref",
                "同じリポジトリを二重に登録している可能性があります",
            ),
            (
                OpKind::Checkout,
                "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/a.ts",
                "チェックアウトできません (変更が上書きされます)",
            ),
            (
                OpKind::Pull,
                "CONFLICT (content): Merge conflict in src/a.ts",
                "競合しました。手元で解決してください",
            ),
            (
                OpKind::Fetch,
                "git@github.com: Permission denied (publickey).",
                "認証に失敗しました",
            ),
            (
                OpKind::Fetch,
                "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/acme/api.git/'",
                "認証に失敗しました",
            ),
            (
                OpKind::Fetch,
                "ssh: Could not resolve hostname github.com",
                "リモートに接続できませんでした",
            ),
            (
                OpKind::Fetch,
                "fatal: Could not read from remote repository.",
                "リモートに接続できませんでした",
            ),
        ];

        for (kind, stderr, expected) in cases {
            assert_eq!(describe(kind, &failed(stderr)), expected, "{stderr}");
        }
    }

    /// `⧉` のブランチをチェックアウトすると必ずこれになる。パスを添える
    #[test]
    fn names_the_worktree_that_holds_the_branch() {
        let output =
            failed("fatal: 'rec-482' is already used by worktree at '/Users/dev/wt/rec-482'");

        assert_eq!(
            describe(OpKind::Checkout, &output),
            "別のワークツリーで使用中です (/Users/dev/wt/rec-482)"
        );
    }

    /// 知らない失敗でも、何が失敗したかは出す
    #[test]
    fn falls_back_to_the_operation_name() {
        let output = failed("fatal: 何か知らない失敗");

        assert_eq!(describe(OpKind::Fetch, &output), "フェッチに失敗しました");
        assert_eq!(
            describe(OpKind::Rename, &output),
            "名前の変更に失敗しました"
        );
        assert_eq!(
            describe(OpKind::Checkout, &output),
            "チェックアウトに失敗しました"
        );
        assert_eq!(describe(OpKind::Push, &output), "プッシュに失敗しました");
        assert_eq!(
            describe(OpKind::ForcePush, &output),
            "強制プッシュに失敗しました"
        );
        assert_eq!(
            describe(OpKind::Previous, &output),
            "チェックアウトに失敗しました"
        );
    }

    /// 打ち切りは終了コードで見分けられない。専用の文言を出す。
    /// **秒数と「リモート」は操作の種別で変わる**
    #[test]
    fn reports_a_timeout_before_anything_else() {
        let output = GitOutput {
            command: "git fetch --prune".to_owned(),
            code: None,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: true,
        };

        assert_eq!(
            describe(OpKind::Fetch, &output),
            "リモートの応答がありません (30 秒で打ち切りました)"
        );
        // ローカルの操作に「リモートの応答」と出すと切り分けができない
        assert_eq!(
            describe(OpKind::Checkout, &output),
            "応答がありません (600 秒で打ち切りました)"
        );
    }

    /// **ローカルの権限エラーを認証の失敗と言わない。**
    /// `.git` に書けないだけなのに SSH 鍵を疑うことになる
    #[test]
    fn does_not_blame_authentication_for_a_local_permission_error() {
        let output =
            failed("fatal: Unable to create '/repos/acme/.git/index.lock': Permission denied");

        assert_eq!(
            describe(OpKind::Checkout, &output),
            "チェックアウトに失敗しました"
        );
        assert_eq!(
            describe(OpKind::Rename, &output),
            "名前の変更に失敗しました"
        );
        // ネットワーク操作なら認証を疑ってよい
        assert_eq!(describe(OpKind::Fetch, &output), "認証に失敗しました");
    }
}
