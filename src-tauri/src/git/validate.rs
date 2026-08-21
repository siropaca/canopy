use std::fmt;

use super::run::{GitError, run};
use crate::store::RepoPath;

/// A reference name that passed validation.
///
/// **git に参照を渡す道はここだけ。** 生の `&str` を受ける実行関数を作らない。
/// `checkout_branch(repo_id, "-f")` の 1 発で `git checkout -f` になり、
/// ワークツリーの未コミット変更が全部消える (docs/security.md)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefName {
    value: String,
    kind: RefKind,
}

impl RefName {
    /// テスト用に、検証を通ったことにして作る。
    #[cfg(test)]
    fn checked_for_test(value: &str, kind: RefKind) -> Self {
        Self {
            value: value.to_owned(),
            kind,
        }
    }
}

/// What the name is meant to be.
///
/// 検証の形が変わるだけで、型としては 1 つ。ブランチ用とタグ用を別の型に
/// 分けていないので、`Composed::tag_ref` にブランチ名を渡すことはできる
/// (検証は通っているので、間違ったブランチを見るだけで破壊は起きない)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefKind {
    /// ブランチ名 (`feature/rec-482`)。リモート追跡の短縮名 (`origin/main`) も含む
    Branch,
    /// タグ名 (`v1.0.3`)
    Tag,
}

/// Why a name was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum RefNameError {
    /// 空、または空白だけ
    Empty,
    /// `-` 始まり。git がオプションとして読む
    LeadingDash { name: String },
    /// `@{` を含む。`@{-1}` は `check-ref-format --branch` を通ってしまう
    Revision { name: String },
    /// `..` を含む。範囲指定として読まれる
    Range { name: String },
    /// `check-ref-format` が弾いた
    Malformed { name: String },
}

impl fmt::Display for RefNameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "名前が空です"),
            Self::LeadingDash { name } => {
                write!(f, "`-` で始まる名前は使えません ({name})")
            }
            Self::Revision { name } => write!(f, "`@{{` を含む名前は使えません ({name})"),
            Self::Range { name } => write!(f, "`..` を含む名前は使えません ({name})"),
            Self::Malformed { name } => write!(f, "参照名として使えません ({name})"),
        }
    }
}

impl std::error::Error for RefNameError {}

impl RefName {
    /// Validate a branch name.
    pub async fn branch(dir: &RepoPath, name: &str) -> Result<Self, GitError> {
        Self::checked(dir, name, RefKind::Branch).await
    }

    /// Validate a tag name.
    pub async fn tag(dir: &RepoPath, name: &str) -> Result<Self, GitError> {
        Self::checked(dir, name, RefKind::Tag).await
    }

    async fn checked(dir: &RepoPath, name: &str, kind: RefKind) -> Result<Self, GitError> {
        reject_dangerous(name)?;
        // `git check-ref-format <名前>` は完全修飾名を要求するので、`hotfix` のような
        // スラッシュ無しの正当な名前を弾く。ブランチは `--branch`、タグは
        // `refs/tags/` を付けた形で渡す (docs/security.md)。
        // `check-ref-format` は parse-options を使わないので `--end-of-options` は
        // 渡せない。`-` 始まりは上で弾いてある
        let qualified = format!("refs/tags/{name}");
        let args: Vec<&str> = match kind {
            RefKind::Branch => vec!["check-ref-format", "--branch", name],
            RefKind::Tag => vec!["check-ref-format", qualified.as_str()],
        };
        if !run(dir, &args).await?.is_ok() {
            return Err(RefNameError::Malformed {
                name: name.to_owned(),
            }
            .into());
        }
        Ok(Self {
            value: name.to_owned(),
            kind,
        })
    }

    pub fn as_str(&self) -> &str {
        &self.value
    }
}

impl fmt::Display for RefName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.value)
    }
}

/// Names `check-ref-format` accepts but git still misreads.
///
/// `--branch '@{-1}'` は妥当な名前として通る (docs/pitfalls.md)。
/// 部分文字列を見るだけなので git を起こさずに判定できる。
fn reject_dangerous(name: &str) -> Result<(), RefNameError> {
    if name.trim().is_empty() {
        return Err(RefNameError::Empty);
    }
    if name.starts_with('-') {
        return Err(RefNameError::LeadingDash {
            name: name.to_owned(),
        });
    }
    if name.contains("@{") {
        return Err(RefNameError::Revision {
            name: name.to_owned(),
        });
    }
    if name.contains("..") {
        return Err(RefNameError::Range {
            name: name.to_owned(),
        });
    }
    Ok(())
}

/// One argument handed to git for a **write** operation.
///
/// 生の `&str` を受ける変種を持たない。参照は検証を通った [`RefName`]、
/// 組み立てた値は [`Composed`] からしか作れないので、新しい操作を足すときに
/// 未検証の名前を git へ渡す道が無い (docs/adr/0017-typed-git-arguments.md)。
#[derive(Debug, Clone, Copy)]
pub enum Arg<'a> {
    /// サブコマンドとオプション。**コードに書いた固定文字列だけ**
    Fixed(&'static str),
    /// 検証を通った参照名
    Ref(&'a RefName),
    /// 組み立てた値。作れるのは [`Composed`] の名前付きコンストラクタからだけ
    Value(&'a Composed),
}

impl Arg<'_> {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Fixed(value) => value,
            Self::Ref(name) => name.as_str(),
            Self::Value(value) => value.as_str(),
        }
    }
}

/// A value assembled from things that already passed through git or validation.
///
/// **フィールドは private。** `write.rs` からは下の名前付きコンストラクタしか
/// 呼べないので、ユーザーから来た文字列がここに入らない。
/// `RepoPath::from_picked_folder` と同じ手口 (docs/security.md)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Composed(String);

impl Composed {
    /// A value that came out of git's own output.
    ///
    /// リモート名 (`git remote`) と追跡先 (`%(upstream:...)`) がこれ。
    /// **呼んで良いのは git の出力をパースした直後だけ。**
    pub fn from_git_output(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// `refs/tags/<名前>`。同名のブランチに逃げないように完全修飾で渡す。
    pub fn tag_ref(tag: &RefName) -> Self {
        Self(format!("refs/tags/{}", tag.as_str()))
    }

    /// `<元>:<先>` の refspec。早送りに使う (`<上流>:<ローカル>`)。
    pub fn refspec(source: &Self, target: &RefName) -> Self {
        Self(format!("{}:{}", source.as_str(), target.as_str()))
    }

    /// `<ローカル>:<上流>` の refspec。プッシュに使う。
    ///
    /// **push 先を明示する。** 名前を省くと git は同名の ref を更新するので、
    /// 上流の名前が違うブランチではリースが更新しない ref に付く。
    pub fn push_refspec(local: &RefName, remote_branch: &Self) -> Self {
        Self(format!("{}:{}", local.as_str(), remote_branch.as_str()))
    }

    /// `--force-with-lease=<参照>:<sha>`。**sha を明示する**
    /// (docs/specs/git-operations.md)。
    pub fn lease(reference: &Self, sha: &ObjectName) -> Self {
        Self(format!(
            "--force-with-lease={}:{}",
            reference.as_str(),
            sha.as_str()
        ))
    }

    /// A validated reference, as a value that can be composed further.
    pub fn of_ref(name: &RefName) -> Self {
        Self(name.as_str().to_owned())
    }

    /// `<元>..<先>` のコミット範囲。
    pub fn range(from: &Self, to: &Self) -> Self {
        Self(format!("{}..{}", from.as_str(), to.as_str()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Composed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// An object name (sha) that passed validation.
///
/// 強制プッシュの `--force-with-lease=<名前>:<sha>` に載る。**フロントが
/// 画面で見せていた sha をそのまま渡してくる**ので、16 進数以外を通さない
/// (docs/specs/git-operations.md の「強制プッシュで sha を明示する理由」)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectName(String);

impl ObjectName {
    /// 短縮 (7 桁) から SHA-256 の 64 桁までを許す。
    pub fn parse(raw: &str) -> Result<Self, ObjectNameError> {
        let value = raw.trim();
        let length = value.chars().count();
        if !(7..=64).contains(&length) || !value.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(ObjectNameError {
                found: raw.to_owned(),
            });
        }
        Ok(Self(value.to_ascii_lowercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ObjectName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Why a sha was refused.
#[derive(Debug, PartialEq, Eq)]
pub struct ObjectNameError {
    pub found: String,
}

impl fmt::Display for ObjectNameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "コミットの sha として読めません ({})", self.found)
    }
}

impl std::error::Error for ObjectNameError {}

#[cfg(test)]
mod tests {
    use super::*;

    /// git を起こさずに弾くもの。`check-ref-format` を通ってしまう形が混ざっている
    #[test]
    fn refuses_names_git_would_misread() {
        assert_eq!(reject_dangerous(""), Err(RefNameError::Empty));
        assert_eq!(reject_dangerous("   "), Err(RefNameError::Empty));
        assert_eq!(
            reject_dangerous("-f"),
            Err(RefNameError::LeadingDash {
                name: "-f".to_owned()
            })
        );
        assert_eq!(
            reject_dangerous("--force"),
            Err(RefNameError::LeadingDash {
                name: "--force".to_owned()
            })
        );
        assert_eq!(
            reject_dangerous("@{-1}"),
            Err(RefNameError::Revision {
                name: "@{-1}".to_owned()
            })
        );
        assert_eq!(
            reject_dangerous("main..develop"),
            Err(RefNameError::Range {
                name: "main..develop".to_owned()
            })
        );
    }

    /// 普通の名前は通す。スラッシュ無しも、日本語も、深い階層も
    #[test]
    fn accepts_ordinary_names() {
        for name in ["hotfix", "feature/rec-482", "release/1.0/rc", "機能/追加"] {
            assert_eq!(reject_dangerous(name), Ok(()), "{name}");
        }
    }

    /// 組み立てた値は、検証を通った型からしか作れない形になっている
    #[test]
    fn assembles_values_from_checked_parts() {
        let tag = RefName::checked_for_test("v1.0", RefKind::Tag);
        let branch = RefName::checked_for_test("main", RefKind::Branch);
        let upstream = Composed::from_git_output("main");
        let sha = ObjectName::parse("9f3c1ab").expect("sha");

        assert_eq!(Composed::tag_ref(&tag).as_str(), "refs/tags/v1.0");
        assert_eq!(Composed::refspec(&upstream, &branch).as_str(), "main:main");
        assert_eq!(
            Composed::push_refspec(&branch, &Composed::from_git_output("trunk")).as_str(),
            "main:trunk",
            "プッシュは <ローカル>:<上流>"
        );
        assert_eq!(
            Composed::lease(&upstream, &sha).as_str(),
            "--force-with-lease=main:9f3c1ab"
        );
        assert_eq!(
            Composed::range(&upstream, &Composed::of_ref(&branch)).as_str(),
            "main..main"
        );
    }

    /// 引数は固定文字列・参照・組み立てた値の 3 種だけ
    #[test]
    fn reads_every_kind_of_argument() {
        let branch = RefName::checked_for_test("feature/a", RefKind::Branch);
        let value = Composed::from_git_output("origin");

        assert_eq!(Arg::Fixed("switch").as_str(), "switch");
        assert_eq!(Arg::Ref(&branch).as_str(), "feature/a");
        assert_eq!(Arg::Value(&value).as_str(), "origin");
    }

    /// 短縮 sha から 64 桁まで。16 進数以外は弾く
    #[test]
    fn parses_only_hexadecimal_object_names() {
        assert_eq!(
            ObjectName::parse("9f3c1ab").expect("short sha").as_str(),
            "9f3c1ab"
        );
        assert_eq!(
            ObjectName::parse("9F3C1AB2D4E6F8A0")
                .expect("upper case")
                .as_str(),
            "9f3c1ab2d4e6f8a0",
            "大文字は小文字に揃える"
        );
        for bad in ["", "9f3c1a", "not-a-sha", "9f3c1ab; rm -rf /", "9f3c 1ab"] {
            assert!(
                ObjectName::parse(bad).is_err(),
                "{bad:?} を通してはいけない"
            );
        }
        assert!(
            ObjectName::parse("0".repeat(65).as_str()).is_err(),
            "65 桁は通してはいけない"
        );
    }
}
