#![allow(dead_code)]
//! 一時ディレクトリに実物のリポジトリを作るヘルパー。
//!
//! モックした git 出力だけで固めると、実際の出力形式とずれたときに気づけない
//! (docs/testing.md)。
//!
//! `tests/` の各ファイルは別クレートなので、使っていないヘルパーが `dead_code` に
//! なって `clippy -D warnings` で落ちる。先頭で許可している。

use std::path::{Path, PathBuf};

use canopy_lib::model::RepoSnapshot;
use canopy_lib::store::Registry;
use tempfile::TempDir;

/// A bare `origin` and a clone of it.
pub struct Fixture {
    root: TempDir,
    origin: PathBuf,
    work: PathBuf,
}

impl Fixture {
    /// `origin` (bare) と、`main` に 1 コミット積んで push したクローンを作る。
    pub async fn new() -> Self {
        let root = tempfile::tempdir().expect("temp dir");
        let origin = root.path().join("origin.git");
        let work = root.path().join("work");

        let fixture = Self { root, origin, work };
        fixture
            .git(
                fixture.root.path(),
                &["init", "--bare", "-b", "main", "origin.git"],
            )
            .await;
        fixture
            .git(fixture.root.path(), &["clone", "origin.git", "work"])
            .await;
        fixture
            .git(&fixture.work, &["config", "user.email", "t@example.com"])
            .await;
        fixture
            .git(&fixture.work, &["config", "user.name", "Test"])
            .await;
        fixture.commit("first").await;
        fixture.work_git(&["push", "-u", "origin", "main"]).await;
        fixture
    }

    pub fn work(&self) -> &Path {
        &self.work
    }

    pub fn origin(&self) -> &Path {
        &self.origin
    }

    pub fn root(&self) -> &Path {
        self.root.path()
    }

    /// Run git and require success. 子プロセスは tokio で起こす
    /// (docs/adr/0009-concurrency-and-refresh.md)。
    pub async fn git(&self, dir: &Path, args: &[&str]) -> String {
        let output = tokio::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_DATE", "2026-08-01T10:00:00+09:00")
            .env("GIT_COMMITTER_DATE", "2026-08-01T10:00:00+09:00")
            .output()
            .await
            .unwrap_or_else(|error| panic!("git {args:?} should start: {error}"));
        assert!(
            output.status.success(),
            "git {args:?} が失敗した: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// Run git in the clone.
    pub async fn work_git(&self, args: &[&str]) -> String {
        self.git(&self.work.clone(), args).await
    }

    /// Write a file and commit it.
    pub async fn commit(&self, name: &str) {
        self.write(name, name);
        self.work_git(&["add", name]).await;
        self.work_git(&["commit", "-m", name]).await;
    }

    /// Write a file in the clone without committing it.
    pub fn write(&self, name: &str, body: &str) {
        self.write_in(&self.work, name, body);
    }

    pub fn write_in(&self, dir: &Path, name: &str, body: &str) {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, body).expect("write file");
    }

    /// Register the clone and read its state.
    pub async fn snapshot(&self) -> RepoSnapshot {
        self.snapshot_of(&self.work.clone(), 1).await
    }

    /// Register `dir` and read its state with the given revision.
    pub async fn snapshot_of(&self, dir: &Path, revision: u64) -> RepoSnapshot {
        let (registry, id) = self.register(dir).await;
        let repo = registry.resolve(&id).expect("registered id resolves");
        let common_dir = registry.common_dir_of(&id).expect("common dir is known");
        let name = registry.name_of(&id).expect("name is known").to_owned();

        canopy_lib::git::build_snapshot(&id, &name, &repo, &common_dir, revision)
            .await
            .expect("snapshot should build")
    }

    /// Register `dir` in a fresh registry. `RepoPath` を作れるのは store だけなので、
    /// テストもこの道を通る (docs/security.md)。
    pub async fn register(&self, dir: &Path) -> (Registry, String) {
        let mut registry = Registry::default();
        let id = self
            .add_to(&mut registry, dir)
            .await
            .expect("first repository should register");
        (registry, id)
    }

    /// Add `dir` to an existing registry, going through the real `--git-common-dir`.
    pub async fn add_to(
        &self,
        registry: &mut Registry,
        dir: &Path,
    ) -> Result<String, canopy_lib::store::AddError> {
        let candidate = canopy_lib::store::RepoPath::from_picked_folder(dir.to_owned());
        let common_dir = canopy_lib::git::common_dir(&candidate)
            .await
            .expect("common dir should be readable");
        let name = dir
            .file_name()
            .expect("directory name")
            .to_string_lossy()
            .into_owned();
        registry.add(name, dir.to_owned(), common_dir)
    }
}
