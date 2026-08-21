use super::ParseError;
use crate::model::Branch;

/// Format for `git for-each-ref refs/heads`.
///
/// `%00` は NUL。参照名に NUL と改行は入らないので、行が壊れない区切りになる。
/// 日時は `committerdate:unix` (秒)。`committerdate:relative` は英語の文字列なので
/// そのまま画面に出せない (docs/adr/0013-type-generation.md)。
///
/// **`refname:short` ではなく `lstrip=2` を使う。** `short` は「曖昧でない範囲で最短化」
/// なので、同名のブランチとタグがあると `heads/v1.0` を返す (実測)。
/// その名前は git に渡せず、`worktree list` の `refs/heads/v1.0` とも一致しないので
/// `⧉` の紐づけが切れる。
pub const LOCAL_BRANCH_FORMAT: &str =
    "%(refname:lstrip=2)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)";

/// Read the output of `git for-each-ref refs/heads` with [`LOCAL_BRANCH_FORMAT`].
pub fn parse_local_branches(stdout: &str) -> Result<Vec<Branch>, ParseError> {
    let mut branches = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\x00').collect();
        let [name, head, upstream, track, committed_at] = fields.as_slice() else {
            return Err(ParseError::new("refs/heads", line));
        };
        if name.is_empty() {
            return Err(ParseError::new("refs/heads", line));
        }
        let committed_at: i64 = committed_at
            .parse()
            .map_err(|_| ParseError::new("refs/heads", line))?;
        let (behind, ahead, gone) =
            parse_track(track).ok_or_else(|| ParseError::new("refs/heads", line))?;

        branches.push(Branch {
            name: (*name).to_owned(),
            // `%(HEAD)` は現在の HEAD なら `*`、それ以外は空白 1 文字。
            // detached のときは全ブランチが空白になる (docs/specs/data-model.md)
            is_current: *head == "*",
            behind,
            ahead,
            upstream: if upstream.is_empty() {
                None
            } else {
                Some((*upstream).to_owned())
            },
            upstream_gone: gone,
            committed_at: committed_at * 1000,
            // ワークツリーは別のコマンドで引いてから埋める
            worktree_path: None,
        });
    }
    Ok(branches)
}

/// Read `%(upstream:track)`: `` / `[gone]` / `[ahead 1]` / `[behind 2]` / `[ahead 1, behind 2]`.
///
/// 返すのは (behind, ahead, gone)。読めなければ `None`。
fn parse_track(track: &str) -> Option<(u32, u32, bool)> {
    if track.is_empty() {
        return Some((0, 0, false));
    }
    let inner = track.strip_prefix('[')?.strip_suffix(']')?;
    if inner == "gone" {
        return Some((0, 0, true));
    }

    let mut behind = 0;
    let mut ahead = 0;
    for part in inner.split(", ") {
        let (label, count) = part.split_once(' ')?;
        let count: u32 = count.parse().ok()?;
        match label {
            "behind" => behind = count,
            "ahead" => ahead = count,
            _ => return None,
        }
    }
    Some((behind, ahead, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 追跡と一致しているブランチ。`upstream:track` は空になる
    #[test]
    fn reads_a_branch_that_matches_its_upstream() {
        let stdout = "main\x00*\x00origin/main\x00\x001787301651\n";

        let branches = parse_local_branches(stdout).expect("should parse");

        assert_eq!(
            branches,
            vec![Branch {
                name: "main".to_owned(),
                is_current: true,
                behind: 0,
                ahead: 0,
                upstream: Some("origin/main".to_owned()),
                upstream_gone: false,
                committed_at: 1_787_301_651_000,
                worktree_path: None,
            }]
        );
    }

    /// `[ahead 1, behind 2]` の両方を読む
    #[test]
    fn reads_ahead_and_behind() {
        let stdout = "develop\x00 \x00origin/develop\x00[ahead 1, behind 2]\x001787301651\n";

        let branches = parse_local_branches(stdout).expect("should parse");

        assert_eq!(branches[0].ahead, 1);
        assert_eq!(branches[0].behind, 2);
        assert!(!branches[0].is_current);
        assert!(!branches[0].upstream_gone);
    }

    /// 片方だけの形も読む
    #[test]
    fn reads_only_behind() {
        let stdout = "main\x00 \x00origin/main\x00[behind 9]\x001787301651\n";

        let branches = parse_local_branches(stdout).expect("should parse");

        assert_eq!((branches[0].behind, branches[0].ahead), (9, 0));
    }

    /// `[gone]` は「追跡先が設定されているが消えている」。
    /// behind / ahead とは別の状態として持つ (docs/pitfalls.md)。
    #[test]
    fn reads_a_gone_upstream() {
        let stdout = "dev/old\x00 \x00origin/dev/old\x00[gone]\x001787301651\n";

        let branches = parse_local_branches(stdout).expect("should parse");

        assert!(branches[0].upstream_gone);
        assert_eq!(branches[0].upstream, Some("origin/dev/old".to_owned()));
        assert_eq!((branches[0].behind, branches[0].ahead), (0, 0));
    }

    /// 追跡が未設定なら `upstream` は null。`upstream_gone` とは別
    /// (docs/specs/data-model.md)。
    #[test]
    fn distinguishes_an_unset_upstream_from_a_gone_one() {
        let stdout = "local-only\x00 \x00\x00\x001787301651\n";

        let branches = parse_local_branches(stdout).expect("should parse");

        assert_eq!(branches[0].upstream, None);
        assert!(!branches[0].upstream_gone);
    }

    /// スラッシュを含む名前をそのまま持つ。ここで分解しない
    #[test]
    fn keeps_the_full_name() {
        let stdout = "feature/rec-482/api\x00 \x00\x00\x001787301651\n";

        let branches = parse_local_branches(stdout).expect("should parse");

        assert_eq!(branches[0].name, "feature/rec-482/api");
    }

    /// 出力が空ならブランチ 0 本。エラーにしない (クローン直後など)
    #[test]
    fn reads_empty_output_as_no_branches() {
        assert_eq!(parse_local_branches(""), Ok(Vec::new()));
        assert_eq!(parse_local_branches("\n"), Ok(Vec::new()));
    }

    /// 想定外の行は捨てずにエラーにする (docs/testing.md)
    #[test]
    fn fails_on_a_line_with_too_few_fields() {
        let error = parse_local_branches("main\x00*\x00origin/main\n").expect_err("should fail");

        assert_eq!(error.context, "refs/heads");
        assert!(error.to_string().contains("main"), "{error}");
    }

    /// 日時が数値でない行もエラーにする
    #[test]
    fn fails_on_a_non_numeric_date() {
        assert!(parse_local_branches("main\x00*\x00origin/main\x00\x00yesterday\n").is_err());
    }

    /// 読めない追跡状態もエラーにする。黙って 0 にしない
    #[test]
    fn fails_on_an_unreadable_track() {
        assert!(
            parse_local_branches("main\x00*\x00origin/main\x00[sideways 3]\x001787301651\n")
                .is_err()
        );
        assert!(
            parse_local_branches("main\x00*\x00origin/main\x00ahead 3\x001787301651\n").is_err()
        );
    }

    /// 名前が空の行もエラーにする
    #[test]
    fn fails_on_an_empty_name() {
        assert!(parse_local_branches("\x00*\x00\x00\x001787301651\n").is_err());
    }
}
