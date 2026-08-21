/// Hide credentials embedded in URLs before the output leaves Rust.
///
/// `https://x-access-token:TOKEN@github.com/...` という構成があり得るので、
/// コンソールに出す前に消す (docs/security.md の「出力の扱い」)。
/// SSH の `git@github.com:acme/api.git` には秘密が無いので触らない。
pub fn mask_credentials(text: &str) -> String {
    let mut masked = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(at) = rest.find("://") {
        masked.push_str(&rest[..at + 3]);
        rest = &rest[at + 3..];

        // authority は次の `/`、空白、引用符、行末まで
        let end = rest
            .find(|c: char| c == '/' || c == '"' || c == '\'' || c.is_whitespace())
            .unwrap_or(rest.len());
        // git と curl は authority の最後の `@` を区切りとして扱う。
        // 最初の `@` で切ると、パスワードに `@` が入っていると断片が残る
        match rest[..end].rsplit_once('@') {
            Some((_, host)) => {
                masked.push_str("***@");
                masked.push_str(host);
            }
            None => masked.push_str(&rest[..end]),
        }
        rest = &rest[end..];
    }

    masked.push_str(rest);
    masked
}

#[cfg(test)]
mod tests {
    use super::*;

    /// トークンが埋まった URL は伏せる
    #[test]
    fn hides_a_token_in_an_https_remote() {
        assert_eq!(
            mask_credentials("To https://x-access-token:ghp_secret@github.com/acme/api.git\n"),
            "To https://***@github.com/acme/api.git\n"
        );
    }

    /// パスワードに `@` が入っていても断片を残さない (docs/pitfalls.md)
    #[test]
    fn cuts_at_the_last_at_sign() {
        assert_eq!(
            mask_credentials("https://user:pa@ss@github.com/acme/api"),
            "https://***@github.com/acme/api"
        );
    }

    /// 1 行に 2 本あっても両方伏せる
    #[test]
    fn hides_every_url_in_the_text() {
        assert_eq!(
            mask_credentials("https://a:b@example.com/x https://c:d@example.org/y"),
            "https://***@example.com/x https://***@example.org/y"
        );
    }

    /// 秘密が無い出力は 1 文字も変えない
    #[test]
    fn leaves_output_without_credentials_alone() {
        for text in [
            "",
            "To github.com:acme/api.git\n   9f3c1ab..2b4d6e8  main -> main\n",
            "git@github.com:acme/api.git",
            "https://github.com/acme/api.git",
            "error: cannot pull with rebase",
        ] {
            assert_eq!(mask_credentials(text), text, "{text:?}");
        }
    }
}
