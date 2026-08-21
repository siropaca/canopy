use super::ParseError;
use crate::model::Ref;

/// Format for `git for-each-ref refs/remotes` and `refs/tags`.
///
/// 日時は `creatordate`。**annotated タグは `committerdate` が空になる** ので
/// commit と tag object の両方に効く `creatordate` を使う (実測)。
///
/// `refname:lstrip=2` を使う理由は [`super::LOCAL_BRANCH_FORMAT`] と同じ。
///
/// 最後の 2 つは「その参照が最終的に何を指しているか」。**commit 以外は落とす。**
/// tree や blob を指す軽量タグは日時を持たないので、
/// 落とさないとリポジトリ 1 件のスナップショットが丸ごとエラーになる (実測)。
pub const REF_FORMAT: &str =
    "%(refname:lstrip=2)%00%(creatordate:unix)%00%(objecttype)%00%(*objecttype)";

/// Read the output of `git for-each-ref` with [`REF_FORMAT`].
pub fn parse_refs(stdout: &str, context: &'static str) -> Result<Vec<Ref>, ParseError> {
    let mut refs = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        let [name, created_at, object_type, target_type] =
            line.split('\x00').collect::<Vec<_>>()[..]
        else {
            return Err(ParseError::new(context, line));
        };
        if name.is_empty() {
            return Err(ParseError::new(context, line));
        }
        // annotated タグは `*objecttype` に、それ以外は `objecttype` に出る
        if object_type != "commit" && target_type != "commit" {
            continue;
        }
        let created_at: i64 = created_at
            .parse()
            .map_err(|_| ParseError::new(context, line))?;
        refs.push(Ref {
            name: name.to_owned(),
            committed_at: created_at * 1000,
        });
    }
    Ok(refs)
}

/// Read `refs/remotes`, dropping the entries that are not remote branches.
///
/// `refs/remotes/origin/HEAD` は短縮すると `origin` になり、リモート名そのものが
/// 参照として混ざる (docs/pitfalls.md)。`/` を含まない参照と `HEAD` で終わる参照を除く。
/// リモート名は `git remote` から渡す。**origin だけとは限らない。**
pub fn parse_remote_refs(stdout: &str, remotes: &[String]) -> Result<Vec<Ref>, ParseError> {
    let mut kept = Vec::new();
    for reference in parse_refs(stdout, "refs/remotes")? {
        if reference.name.ends_with("/HEAD") {
            continue;
        }
        if split_remote_ref(&reference.name, remotes).is_none() {
            continue;
        }
        kept.push(reference);
    }
    Ok(kept)
}

/// Split `origin/feature/x` into (`origin`, `feature/x`).
///
/// リモート名にも `/` が入り得るので、長いリモート名から順に見る。
/// どのリモートにも属さない参照と、ブランチ部分が空の参照は `None`。
pub fn split_remote_ref<'a>(name: &'a str, remotes: &[String]) -> Option<(&'a str, &'a str)> {
    let mut candidates: Vec<&String> = remotes.iter().collect();
    candidates.sort_by_key(|remote| std::cmp::Reverse(remote.len()));

    for remote in candidates {
        if let Some(branch) = name
            .strip_prefix(remote.as_str())
            .and_then(|rest| rest.strip_prefix('/'))
            && !branch.is_empty()
        {
            return Some((&name[..remote.len()], branch));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `commit` / `*objecttype` の 2 列を足した形。annotated タグは後者に出る
    fn line(name: &str, at: &str, object_type: &str, target_type: &str) -> String {
        format!("{name}\x00{at}\x00{object_type}\x00{target_type}\n")
    }

    #[test]
    fn reads_a_name_and_a_date() {
        let stdout = format!(
            "{}{}",
            line("origin/develop", "1787301651", "commit", ""),
            line("v1.0.0", "1787301652", "tag", "commit"),
        );
        let stdout = stdout.as_str();

        let refs = parse_refs(stdout, "refs/tags").expect("should parse");

        assert_eq!(
            refs,
            vec![
                Ref {
                    name: "origin/develop".to_owned(),
                    committed_at: 1_787_301_651_000,
                },
                Ref {
                    name: "v1.0.0".to_owned(),
                    committed_at: 1_787_301_652_000,
                },
            ]
        );
    }

    /// commit を指しているのに日時が空なら、気づけるようにエラーにする。
    /// 0 を入れると「1970 年」と表示されて原因が分からない
    #[test]
    fn fails_on_an_empty_date() {
        let error =
            parse_refs(&line("annotated", "", "tag", "commit"), "refs/tags").expect_err("fail");

        assert_eq!(error.context, "refs/tags");
    }

    /// tree や blob を指す軽量タグは落とす。
    /// 日時を持たないので、残すとリポジトリ 1 件が丸ごとエラーになる (実測)
    #[test]
    fn drops_refs_that_do_not_point_at_a_commit() {
        let stdout = format!(
            "{}{}{}",
            line("tree-tag", "", "tree", ""),
            line("blob-tag", "", "blob", ""),
            line("v1.0.0", "1787301651", "commit", ""),
        );

        let refs = parse_refs(&stdout, "refs/tags").expect("should parse");

        assert_eq!(
            refs.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            vec!["v1.0.0"]
        );
    }

    /// annotated タグは `*objecttype` が commit なので残す
    #[test]
    fn keeps_an_annotated_tag() {
        let refs = parse_refs(&line("ann", "1787301651", "tag", "commit"), "refs/tags")
            .expect("should parse");

        assert_eq!(refs.len(), 1);
    }

    #[test]
    fn fails_on_a_line_with_too_many_fields() {
        assert!(parse_refs("a\x00b\x00c\x00d\x00e\n", "refs/tags").is_err());
    }

    /// `refs/remotes/origin/HEAD` を短縮した `origin` を除く (docs/pitfalls.md)
    #[test]
    fn drops_the_remote_name_itself() {
        let stdout = format!(
            "{}{}",
            line("origin", "1787301651", "commit", ""),
            line("origin/main", "1787301651", "commit", "")
        );
        let stdout = stdout.as_str();
        let remotes = vec!["origin".to_owned()];

        let refs = parse_remote_refs(stdout, &remotes).expect("should parse");

        assert_eq!(
            refs.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            vec!["origin/main"]
        );
    }

    /// `HEAD` で終わる参照も除く
    #[test]
    fn drops_refs_ending_with_head() {
        let stdout = format!(
            "{}{}",
            line("origin/HEAD", "1787301651", "commit", ""),
            line("origin/main", "1787301651", "commit", "")
        );
        let stdout = stdout.as_str();
        let remotes = vec!["origin".to_owned()];

        let refs = parse_remote_refs(stdout, &remotes).expect("should parse");

        assert_eq!(
            refs.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            vec!["origin/main"]
        );
    }

    /// fork があると origin 以外のリモートが並ぶ。全部残す
    /// (docs/specs/git-operations.md)
    #[test]
    fn keeps_refs_of_every_remote() {
        let stdout = format!(
            "{}{}",
            line("origin/main", "1787301651", "commit", ""),
            line("upstream/main", "1787301651", "commit", "")
        );
        let stdout = stdout.as_str();
        let remotes = vec!["origin".to_owned(), "upstream".to_owned()];

        let refs = parse_remote_refs(stdout, &remotes).expect("should parse");

        assert_eq!(
            refs.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            vec!["origin/main", "upstream/main"]
        );
    }

    /// 知らないリモートの参照は落とす。リモート名を推測しない
    #[test]
    fn drops_refs_of_unknown_remotes() {
        let stdout = line("ghost/main", "1787301651", "commit", "");
        let stdout = stdout.as_str();
        let remotes = vec!["origin".to_owned()];

        assert!(
            parse_remote_refs(stdout, &remotes)
                .expect("should parse")
                .is_empty()
        );
    }

    /// origin 以外のリモート名でも正しく分解する
    #[test]
    fn splits_on_the_remote_name() {
        let remotes = vec!["origin".to_owned(), "upstream".to_owned()];

        assert_eq!(
            split_remote_ref("upstream/feature/x", &remotes),
            Some(("upstream", "feature/x"))
        );
        assert_eq!(
            split_remote_ref("origin/main", &remotes),
            Some(("origin", "main"))
        );
    }

    /// リモート名に `/` が入っていても、長い名前から先に当てる
    #[test]
    fn prefers_the_longest_remote_name() {
        let remotes = vec!["team".to_owned(), "team/fork".to_owned()];

        assert_eq!(
            split_remote_ref("team/fork/main", &remotes),
            Some(("team/fork", "main"))
        );
    }

    /// ブランチ部分が無い参照は分解できない
    #[test]
    fn does_not_split_a_bare_remote_name() {
        let remotes = vec!["origin".to_owned()];

        assert_eq!(split_remote_ref("origin", &remotes), None);
        assert_eq!(split_remote_ref("origin/", &remotes), None);
        assert_eq!(split_remote_ref("originish/main", &remotes), None);
    }
}
