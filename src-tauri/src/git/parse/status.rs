use super::ParseError;
use crate::model::{Change, ChangeList};

/// Read the output of `git status --porcelain -z`.
///
/// `-z` は NUL 区切り。ファイル名に空白や改行が入っても壊れない
/// (docs/specs/git-operations.md の「共通」)。
/// 改名と複写は `XY <新しいパス>\x00<元のパス>\x00` の 2 区画になる (実測)。
///
/// `limit` 件までを `items` に入れ、`total` には全体の件数を入れる。
/// **全件を IPC に載せない。** `.gitignore` を整える前のリポジトリでは数千行返る
/// (docs/specs/data-model.md)。
pub fn parse_status(stdout: &str, limit: usize) -> Result<ChangeList, ParseError> {
    let mut entries = stdout.split('\x00').peekable();
    let mut items = Vec::new();
    let mut total = 0;

    while let Some(entry) = entries.next() {
        if entry.is_empty() {
            continue;
        }
        let (status, path) = split_entry(entry)?;
        // 改名と複写は次の区画に元のパスが続く。表示には使わないので読み捨てる
        if matches!(status.as_str(), "R" | "C") {
            entries.next();
        }
        total += 1;
        if items.len() < limit {
            items.push(Change { status, path });
        }
    }

    Ok(ChangeList { items, total })
}

/// Split `XY <path>` into a single status letter and the path.
fn split_entry(entry: &str) -> Result<(String, String), ParseError> {
    let error = || ParseError::new("status --porcelain", entry);
    let (code, rest) = entry.split_at_checked(2).ok_or_else(error)?;
    let path = rest.strip_prefix(' ').ok_or_else(error)?;
    if path.is_empty() {
        return Err(error());
    }

    let status = if code == "??" {
        "??".to_owned()
    } else if is_unmerged(code) {
        // 競合はステージ状態が 2 文字とも埋まる。1 文字に潰すと `D` に見える
        "U".to_owned()
    } else {
        code.chars()
            .find(|letter| *letter != ' ')
            .ok_or_else(error)?
            .to_string()
    };
    Ok((status, path.to_owned()))
}

/// Whether `code` is one of the unmerged combinations.
fn is_unmerged(code: &str) -> bool {
    matches!(code, "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(status: &str, path: &str) -> Change {
        Change {
            status: status.to_owned(),
            path: path.to_owned(),
        }
    }

    /// 実測した出力をそのまま読む
    #[test]
    fn reads_the_real_output() {
        let stdout = "RM renamed.txt\x00a.txt\x00A  sub/d.txt\x00?? u.txt\x00";

        let changes = parse_status(stdout, 20).expect("should parse");

        assert_eq!(
            changes.items,
            vec![
                change("R", "renamed.txt"),
                change("A", "sub/d.txt"),
                change("??", "u.txt"),
            ]
        );
        assert_eq!(changes.total, 3);
    }

    /// ワークツリー側だけの変更も 1 文字に潰す
    #[test]
    fn reads_a_worktree_only_change() {
        let changes = parse_status(" M src/main.rs\x00", 20).expect("should parse");

        assert_eq!(changes.items, vec![change("M", "src/main.rs")]);
    }

    /// 競合は `U`。`DD` を `D` に潰すと削除に見える
    #[test]
    fn reads_a_conflict_as_unmerged() {
        let changes = parse_status("UU a.txt\x00DD b.txt\x00", 20).expect("should parse");

        assert_eq!(
            changes.items,
            vec![change("U", "a.txt"), change("U", "b.txt")]
        );
    }

    /// 空白や日本語を含むパスも壊れない
    #[test]
    fn reads_paths_with_spaces_and_japanese() {
        let changes = parse_status("?? docs/新しい 資料.md\x00", 20).expect("should parse");

        assert_eq!(changes.items, vec![change("??", "docs/新しい 資料.md")]);
    }

    /// `limit` を超えた分は `items` に入れず `total` だけ増やす
    /// (docs/specs/data-model.md)
    #[test]
    fn caps_items_but_counts_everything() {
        let stdout = (1..=25)
            .map(|n| format!("?? f{n}.txt\x00"))
            .collect::<String>();

        let changes = parse_status(&stdout, 21).expect("should parse");

        assert_eq!(changes.items.len(), 21);
        assert_eq!(changes.total, 25);
    }

    /// 改名の元のパスを 1 件として数えない
    #[test]
    fn does_not_count_the_original_path_of_a_rename() {
        let changes = parse_status("R  new.txt\x00old.txt\x00", 20).expect("should parse");

        assert_eq!(changes.total, 1);
        assert_eq!(changes.items, vec![change("R", "new.txt")]);
    }

    /// 変更なしは空
    #[test]
    fn reads_no_changes() {
        let changes = parse_status("", 20).expect("should parse");

        assert_eq!(changes.total, 0);
        assert!(changes.items.is_empty());
    }

    /// 想定外の区画はエラーにする
    #[test]
    fn fails_on_a_short_entry() {
        assert!(parse_status("M\x00", 20).is_err());
        assert!(parse_status("M  \x00", 20).is_err());
        assert!(parse_status("MMa.txt\x00", 20).is_err());
        assert!(parse_status("   a.txt\x00", 20).is_err());
    }
}
