//! Persisted settings: the repository list, its order and the UI state.
//!
//! 読み書きするのは Rust 側だけ。フロントは `UiState` しか触らない
//! (docs/adr/0016-store-without-plugin.md)。

mod repo_path;

use std::fmt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::{RepoRegistration, UiState};

pub use repo_path::RepoPath;

/// Bumped when the shape of the file changes.
pub const SCHEMA_VERSION: u32 = 1;

/// Application `open -a` hands the repository path to.
///
/// v1 に設定画面は無いので、変えるときは設定ファイルを直接編集する
/// (docs/adr/0015-auxiliary-operations.md)。
pub const DEFAULT_TERMINAL_APP: &str = "Terminal";

fn default_terminal_app() -> String {
    DEFAULT_TERMINAL_APP.to_owned()
}

/// One registered repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct RepoEntry {
    id: String,
    /// Display name. The directory name at registration time.
    name: String,
    path: PathBuf,
    /// Real path of `git rev-parse --git-common-dir`.
    ///
    /// リポジトリの同一性の判定に使う。リンクされたワークツリーは ref store を
    /// メインと共有しているので、別々に登録すると `unable to update local ref` で
    /// 落ちる (docs/specs/git-operations.md の「重複の判定」)。
    common_dir: PathBuf,
}

/// The whole settings file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Registry {
    version: u32,
    /// Next number for a repository id.
    next_id: u32,
    repos: Vec<RepoEntry>,
    ui_state: UiState,
    /// 「ターミナルで開く」が起動するアプリ。既定は macOS の Terminal。
    ///
    /// 増えた項目なので `serde(default)` を付ける。付けないと、この項目が無い
    /// 既存の設定ファイルが「壊れている」と判定される。
    #[serde(default = "default_terminal_app")]
    terminal_app: String,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            next_id: 1,
            repos: Vec::new(),
            ui_state: UiState::default(),
            terminal_app: default_terminal_app(),
        }
    }
}

/// Why a repository could not be registered.
#[derive(Debug, PartialEq, Eq)]
pub enum AddError {
    /// The same repository (or one of its worktrees) is already registered.
    Duplicate { name: String },
}

impl fmt::Display for AddError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Duplicate { name } => write!(
                f,
                "このリポジトリは登録済みです ({name})。ワークツリーは別のリポジトリとして登録できません"
            ),
        }
    }
}

/// Why a repository order could not be applied.
#[derive(Debug, PartialEq, Eq)]
pub struct UnknownRepo(pub String);

impl fmt::Display for UnknownRepo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "知らないリポジトリの id です ({})", self.0)
    }
}

/// Why the settings file could not be read or written.
#[derive(Debug)]
pub enum StoreError {
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
    Version {
        path: PathBuf,
        found: u32,
    },
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, source } => {
                write!(f, "設定を読めませんでした ({}): {source}", path.display())
            }
            Self::Parse { path, source } => {
                write!(f, "設定の中身が壊れています ({}): {source}", path.display())
            }
            Self::Version { path, found } => write!(
                f,
                "設定の版が新しすぎます ({}): {found} (このアプリが読めるのは {SCHEMA_VERSION})",
                path.display()
            ),
            Self::Write { path, source } => {
                write!(
                    f,
                    "設定を保存できませんでした ({}): {source}",
                    path.display()
                )
            }
        }
    }
}

impl Registry {
    /// Read the settings file. A missing file is the empty state, not an error.
    ///
    /// 壊れているファイルは握りつぶさない。黙って初期状態で上書きすると
    /// 登録したリポジトリが消える (docs/adr/0016-store-without-plugin.md)。
    pub fn load(path: &Path) -> Result<Self, StoreError> {
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(source) => {
                return Err(StoreError::Read {
                    path: path.to_owned(),
                    source,
                });
            }
        };

        let mut registry: Self =
            serde_json::from_str(&raw).map_err(|source| StoreError::Parse {
                path: path.to_owned(),
                source,
            })?;
        if registry.version > SCHEMA_VERSION {
            return Err(StoreError::Version {
                path: path.to_owned(),
                found: registry.version,
            });
        }
        registry.prune();
        Ok(registry)
    }

    /// Write the settings file, creating the directory if needed.
    pub fn save(&self, path: &Path) -> Result<(), StoreError> {
        let write = |source| StoreError::Write {
            path: path.to_owned(),
            source,
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(write)?;
        }
        let body = serde_json::to_string_pretty(self).expect("Registry should serialize");
        // 一時ファイルに書いてから置き換える。書き込み中に落ちても元のファイルが残る
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, body).map_err(write)?;
        std::fs::rename(&temporary, path).map_err(write)
    }

    /// Drop keys and ids that no longer point at a registered repository.
    fn prune(&mut self) {
        let known: Vec<&str> = self.repos.iter().map(|repo| repo.id.as_str()).collect();
        self.ui_state
            .repo_order
            .retain(|id| known.contains(&id.as_str()));
        for repo in &self.repos {
            if !self.ui_state.repo_order.contains(&repo.id) {
                self.ui_state.repo_order.push(repo.id.clone());
            }
        }
        self.ui_state
            .expanded
            .retain(|key| known.iter().any(|id| key.starts_with(&format!("{id}|"))));
    }

    /// Register a repository. `common_dir` decides whether it is a duplicate.
    pub fn add(
        &mut self,
        name: String,
        path: PathBuf,
        common_dir: PathBuf,
    ) -> Result<String, AddError> {
        if let Some(existing) = self.repos.iter().find(|repo| repo.common_dir == common_dir) {
            return Err(AddError::Duplicate {
                name: existing.name.clone(),
            });
        }

        let id = format!("r{}", self.next_id);
        self.next_id += 1;
        self.repos.push(RepoEntry {
            id: id.clone(),
            name,
            path,
            common_dir,
        });
        self.ui_state.repo_order.push(id.clone());
        Ok(id)
    }

    /// Forget a repository. ディスクには触らない (docs/specs/git-operations.md)。
    pub fn remove(&mut self, id: &str) {
        self.repos.retain(|repo| repo.id != id);
        self.ui_state.repo_order.retain(|other| other != id);
        let prefix = format!("{id}|");
        self.ui_state
            .expanded
            .retain(|key| !key.starts_with(&prefix));
    }

    /// Registered repositories, in display order.
    pub fn registrations(&self) -> Vec<RepoRegistration> {
        self.ui_state
            .repo_order
            .iter()
            .filter_map(|id| self.repos.iter().find(|repo| &repo.id == id))
            .map(|repo| RepoRegistration {
                id: repo.id.clone(),
                name: repo.name.clone(),
                path: repo.path.to_string_lossy().into_owned(),
            })
            .collect()
    }

    /// The only way to turn an id into a directory git may run in.
    pub fn resolve(&self, id: &str) -> Option<RepoPath> {
        self.repos
            .iter()
            .find(|repo| repo.id == id)
            .map(|repo| RepoPath::registered(repo.path.clone()))
    }

    /// Real path of the repository's `--git-common-dir`.
    ///
    /// 直列キューのキーと、`FETCH_HEAD` を読む場所に使う
    /// (docs/adr/0009-concurrency-and-refresh.md)。
    pub fn common_dir_of(&self, id: &str) -> Option<PathBuf> {
        self.repos
            .iter()
            .find(|repo| repo.id == id)
            .map(|repo| repo.common_dir.clone())
    }

    pub fn name_of(&self, id: &str) -> Option<&str> {
        self.repos
            .iter()
            .find(|repo| repo.id == id)
            .map(|repo| repo.name.as_str())
    }

    pub fn ui_state(&self) -> &UiState {
        &self.ui_state
    }

    pub fn terminal_app(&self) -> &str {
        &self.terminal_app
    }

    /// Replace the UI state. `repo_order` は登録済みの id だけに整える。
    pub fn set_ui_state(&mut self, ui_state: UiState) {
        self.ui_state = ui_state;
        self.prune();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry_with_one() -> (Registry, String) {
        let mut registry = Registry::default();
        let id = registry
            .add(
                "acme-api".to_owned(),
                PathBuf::from("/repos/acme-api"),
                PathBuf::from("/repos/acme-api/.git"),
            )
            .expect("first repository should register");
        (registry, id)
    }

    /// id は登録の順に発行する。同じディレクトリ名でも別の id になる
    /// (docs/specs/data-model.md の「鍵にはリポジトリ名ではなく id を使う」)。
    #[test]
    fn issues_a_new_id_for_every_repository() {
        let (mut registry, first) = registry_with_one();

        let second = registry
            .add(
                "acme-api".to_owned(),
                PathBuf::from("/other/acme-api"),
                PathBuf::from("/other/acme-api/.git"),
            )
            .expect("a different repository should register");

        assert_eq!(first, "r1");
        assert_eq!(second, "r2");
        assert_eq!(registry.ui_state().repo_order, vec!["r1", "r2"]);
    }

    /// ワークツリーのパスを登録しようとしたら弾く。
    /// `--git-common-dir` がメインと同じになるので判定できる
    /// (docs/specs/git-operations.md の「重複の判定」)。
    #[test]
    fn rejects_a_worktree_of_a_registered_repository() {
        let (mut registry, _) = registry_with_one();

        let result = registry.add(
            "rec-501-flag".to_owned(),
            PathBuf::from("/worktrees/rec-501-flag"),
            PathBuf::from("/repos/acme-api/.git"),
        );

        assert_eq!(
            result,
            Err(AddError::Duplicate {
                name: "acme-api".to_owned()
            })
        );
        assert_eq!(registry.registrations().len(), 1);
    }

    /// 同じパスをもう一度登録しようとしても増えない
    #[test]
    fn rejects_the_same_repository_twice() {
        let (mut registry, _) = registry_with_one();

        let result = registry.add(
            "acme-api".to_owned(),
            PathBuf::from("/repos/acme-api"),
            PathBuf::from("/repos/acme-api/.git"),
        );

        assert!(result.is_err());
    }

    /// 削除するとその id の折りたたみキーも消える。
    /// 残すと `repo_order` と `expanded` が不整合になる。
    #[test]
    fn removing_a_repository_drops_its_keys() {
        let (mut registry, id) = registry_with_one();
        let mut ui_state = registry.ui_state().clone();
        ui_state.expanded = vec![
            format!("{id}|repo|"),
            format!("{id}|local|feature"),
            "r9|repo|".to_owned(),
        ];
        registry.set_ui_state(ui_state);

        registry.remove(&id);

        assert!(registry.registrations().is_empty());
        assert!(registry.ui_state().expanded.is_empty());
        assert!(registry.ui_state().repo_order.is_empty());
    }

    /// **`|` の境界で id を見る。** `r1` を消しても `r10` の鍵は残る。
    /// 前方一致だけで判定すると、似た id のリポジトリを巻き込む
    /// (docs/specs/data-model.md の鍵の形式)。
    #[test]
    fn treats_the_id_boundary_when_removing() {
        let mut registry = Registry::default();
        for index in 1..=10 {
            registry
                .add(
                    format!("repo-{index}"),
                    PathBuf::from(format!("/repos/{index}")),
                    PathBuf::from(format!("/repos/{index}/.git")),
                )
                .expect("each repository registers");
        }
        let mut ui_state = registry.ui_state().clone();
        ui_state.expanded = vec!["r1|repo|".to_owned(), "r10|repo|".to_owned()];
        registry.set_ui_state(ui_state);

        registry.remove("r1");

        assert_eq!(registry.ui_state().expanded, vec!["r10|repo|"]);
    }

    /// 読み込み時も同じ境界で見る。`r1` しか無ければ `r10` の鍵は捨てる
    #[test]
    fn treats_the_id_boundary_when_pruning() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("canopy.json");
        let (mut registry, id) = registry_with_one();
        let mut ui_state = registry.ui_state().clone();
        ui_state.expanded = vec![format!("{id}|repo|"), "r10|repo|".to_owned()];
        registry.set_ui_state(ui_state);
        registry.save(&path).expect("save should succeed");

        let loaded = Registry::load(&path).expect("load should succeed");

        assert_eq!(loaded.ui_state().expanded, vec![format!("{id}|repo|")]);
    }

    /// 一時ファイルに書いてから置き換える。保存が終わったら残さない
    #[test]
    fn saves_through_a_temporary_file() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("canopy.json");
        let (registry, _) = registry_with_one();

        registry.save(&path).expect("save should succeed");

        let left: Vec<String> = std::fs::read_dir(directory.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(left, vec!["canopy.json".to_owned()]);
    }

    /// 保存できないときは元のファイルを壊さない
    #[test]
    fn keeps_the_old_file_when_saving_fails() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("canopy.json");
        let (registry, _) = registry_with_one();
        registry.save(&path).expect("save should succeed");
        let before = std::fs::read_to_string(&path).expect("read");
        // 既にファイルがある位置をディレクトリとして使わせて、書き込みを失敗させる
        let blocked = path.join("nested").join("canopy.json");

        let error = registry.save(&blocked).expect_err("save should fail");

        assert!(matches!(error, StoreError::Write { .. }), "{error}");
        assert_eq!(std::fs::read_to_string(&path).expect("read"), before);
    }

    /// 読み込み時に、存在しないリポジトリのキーを捨てる
    /// (docs/specs/data-model.md)。
    #[test]
    fn load_drops_keys_of_unknown_repositories() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("canopy.json");
        let (mut registry, id) = registry_with_one();
        let mut ui_state = registry.ui_state().clone();
        ui_state.expanded = vec![format!("{id}|repo|"), "r404|repo|".to_owned()];
        ui_state.repo_order = vec![id.clone(), "r404".to_owned()];
        registry.set_ui_state(ui_state);
        registry.save(&path).expect("save should succeed");

        let loaded = Registry::load(&path).expect("load should succeed");

        assert_eq!(loaded.ui_state().expanded, vec![format!("{id}|repo|")]);
        assert_eq!(loaded.ui_state().repo_order, vec![id]);
    }

    /// 増えた項目が無い設定ファイルも読める。**壊れている扱いにしない**
    #[test]
    fn load_fills_in_a_setting_added_later() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("canopy.json");
        std::fs::write(
            &path,
            r#"{"version":1,"next_id":1,"repos":[],"ui_state":{"repo_order":[],"expanded":[],"pane_width":360,"console_open":false,"window":null,"group_directories":true,"local_only":false}}"#,
        )
        .expect("write");

        let loaded = Registry::load(&path).expect("load should succeed");

        assert_eq!(loaded.terminal_app(), DEFAULT_TERMINAL_APP);
    }

    /// ファイルが無いのは空の状態。エラーにしない
    #[test]
    fn load_treats_a_missing_file_as_empty() {
        let directory = tempfile::tempdir().expect("temp dir");

        let loaded = Registry::load(&directory.path().join("none.json")).expect("missing is empty");

        assert_eq!(loaded, Registry::default());
    }

    /// 壊れたファイルは握りつぶさない。初期状態で上書きしない
    /// (docs/adr/0016-store-without-plugin.md)。
    #[test]
    fn load_fails_on_a_broken_file() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("canopy.json");
        std::fs::write(&path, "{ これは JSON ではない").expect("write");

        let error = Registry::load(&path).expect_err("broken file should fail");

        assert!(matches!(error, StoreError::Parse { .. }), "{error}");
    }

    /// 新しい版の設定を古いアプリで読んだら止まる。読める形に落として上書きしない
    #[test]
    fn load_fails_on_a_newer_version() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("canopy.json");
        let registry = Registry {
            version: SCHEMA_VERSION + 1,
            ..Registry::default()
        };
        registry.save(&path).expect("save should succeed");

        let error = Registry::load(&path).expect_err("newer version should fail");

        assert!(matches!(error, StoreError::Version { .. }), "{error}");
    }

    /// 保存して読み直すと同じ状態になる
    #[test]
    fn saves_and_loads_the_same_state() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("nested").join("canopy.json");
        let (registry, _) = registry_with_one();

        registry.save(&path).expect("save should succeed");

        assert_eq!(
            Registry::load(&path).expect("load should succeed"),
            registry
        );
    }

    /// id からパスを引けるのは store だけ (docs/security.md)
    #[test]
    fn resolves_an_id_to_a_path() {
        let (registry, id) = registry_with_one();

        let resolved = registry.resolve(&id).expect("registered id resolves");

        assert_eq!(resolved.as_path(), Path::new("/repos/acme-api"));
        assert!(registry.resolve("r404").is_none());
    }
}
