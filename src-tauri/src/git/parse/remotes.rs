/// Read the output of `git remote` (one name per line).
pub fn parse_remotes(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Normalise the `origin` URL to its https form.
///
/// - `git@github.com:acme/api.git` -> `https://github.com/acme/api`
/// - `ssh://git@github.com/acme/api.git` -> `https://github.com/acme/api`
///
/// **認証情報は落とす。** `https://x-access-token:TOKEN@github.com/...` という構成が
/// あり得るので、そのまま画面に出さない (docs/security.md)。
/// https に直せない指定 (ローカルパスなど) はそのまま返す。
pub fn normalize_origin_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let host_and_path = if let Some((scheme, rest)) = trimmed.split_once("://") {
        match scheme {
            "ssh" | "git" | "http" | "https" => strip_credentials(rest).to_owned(),
            // file:// などは https の形を持たない
            _ => return Some(trim_git_suffix(trimmed).to_owned()),
        }
    } else if let Some(rest) = scp_like(trimmed) {
        rest
    } else {
        // ローカルパスなど
        return Some(trim_git_suffix(trimmed).to_owned());
    };

    Some(format!("https://{}", trim_git_suffix(&host_and_path)))
}

/// Turn `git@github.com:acme/api.git` into `github.com/acme/api.git`.
fn scp_like(raw: &str) -> Option<String> {
    let (before, after) = raw.split_once(':')?;
    // Windows のドライブレターや `http:` のような形を弾く
    if after.starts_with('/') || before.contains('/') {
        return None;
    }
    let host = strip_credentials(before);
    if host.is_empty() || after.is_empty() {
        return None;
    }
    Some(format!("{host}/{after}"))
}

/// Drop everything up to and including the **last** `@`.
///
/// git と curl は authority の最後の `@` を区切りとして扱う。
/// 最初の `@` で切ると、パスワードに `@` が入っている場合に断片が残る (実測)。
fn strip_credentials(rest: &str) -> &str {
    match rest.rsplit_once('@') {
        Some((_, after)) => after,
        None => rest,
    }
}

fn trim_git_suffix(value: &str) -> &str {
    value
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or_else(|| value.trim_end_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_remote_names() {
        assert_eq!(
            parse_remotes("origin\nupstream\n"),
            vec!["origin".to_owned(), "upstream".to_owned()]
        );
        assert!(parse_remotes("").is_empty());
        assert!(parse_remotes("\n\n").is_empty());
    }

    /// SSH の指定を https に直す
    #[test]
    fn normalizes_the_ssh_form() {
        assert_eq!(
            normalize_origin_url("git@github.com:acme/acme-api.git"),
            Some("https://github.com/acme/acme-api".to_owned())
        );
        assert_eq!(
            normalize_origin_url("ssh://git@github.com/acme/acme-api.git"),
            Some("https://github.com/acme/acme-api".to_owned())
        );
    }

    /// https はそのまま。末尾の `.git` は落とす
    #[test]
    fn trims_the_git_suffix() {
        assert_eq!(
            normalize_origin_url("https://github.com/acme/acme-api.git"),
            Some("https://github.com/acme/acme-api".to_owned())
        );
        assert_eq!(
            normalize_origin_url("https://github.com/acme/acme-api/"),
            Some("https://github.com/acme/acme-api".to_owned())
        );
    }

    /// パスワードに `@` が入っていても断片を残さない
    #[test]
    fn drops_credentials_with_an_at_sign_in_the_password() {
        assert_eq!(
            normalize_origin_url("https://user:pa@ss@gitlab.example.jp/team/tool.git"),
            Some("https://gitlab.example.jp/team/tool".to_owned())
        );
    }

    /// URL に埋まったトークンは表示前に落とす (docs/security.md)
    #[test]
    fn drops_credentials() {
        assert_eq!(
            normalize_origin_url("https://x-access-token:ghs_secret@github.com/acme/api.git"),
            Some("https://github.com/acme/api".to_owned())
        );
        assert!(
            !normalize_origin_url("git@github.com:acme/api.git")
                .expect("should normalize")
                .contains('@')
        );
    }

    /// GitHub 以外のホストも同じ形に直す
    #[test]
    fn normalizes_other_hosts() {
        assert_eq!(
            normalize_origin_url("git@gitlab.example.jp:team/tool.git"),
            Some("https://gitlab.example.jp/team/tool".to_owned())
        );
    }

    /// https に直せない指定はそのまま返す。捨てるとリモートが無いように見える
    #[test]
    fn keeps_a_local_path_as_it_is() {
        assert_eq!(
            normalize_origin_url("/Users/dev/mirrors/api.git"),
            Some("/Users/dev/mirrors/api".to_owned())
        );
        assert_eq!(
            normalize_origin_url("file:///Users/dev/mirrors/api.git"),
            Some("file:///Users/dev/mirrors/api".to_owned())
        );
    }

    /// 出力が空 (origin が無い) なら None
    #[test]
    fn reads_no_url() {
        assert_eq!(normalize_origin_url(""), None);
        assert_eq!(normalize_origin_url("  \n"), None);
    }
}
