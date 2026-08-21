//! State shared by every command.

use std::fmt;
use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use crate::queue::GitQueue;
use crate::store::{Registry, RepoPath, UnknownRepo};

/// Name of the settings file inside the app's config directory.
pub const SETTINGS_FILE: &str = "canopy.json";

/// Everything the commands need. Tauri が管理する 1 個のインスタンス。
pub struct AppState {
    settings_path: PathBuf,
    /// `Err` は設定ファイルが読めなかったとき。
    ///
    /// 読めないまま保存すると、登録したリポジトリを初期状態で上書きしてしまう
    /// (docs/adr/0016-store-without-plugin.md)。
    settings: Mutex<Result<Registry, String>>,
    queue: GitQueue,
}

/// Why the state could not answer.
///
/// IPC の型に変換するのは `commands` 側。**この層は commands を知らない**
/// (docs/architecture.md の依存の向き)。
#[derive(Debug)]
pub enum StateError {
    /// 設定ファイルが読めていない
    Settings(String),
    /// 知らないリポジトリの id
    UnknownRepo(UnknownRepo),
}

impl fmt::Display for StateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Settings(reason) => write!(f, "{reason}"),
            Self::UnknownRepo(error) => write!(f, "{error}"),
        }
    }
}

impl From<UnknownRepo> for StateError {
    fn from(error: UnknownRepo) -> Self {
        Self::UnknownRepo(error)
    }
}

/// One repository, resolved from its id.
#[derive(Debug)]
pub struct Located {
    pub name: String,
    pub dir: RepoPath,
    pub common_dir: PathBuf,
}

impl AppState {
    /// Read the settings file. 読めなくても起動はする。
    pub fn load(settings_path: PathBuf) -> Self {
        let settings = Registry::load(&settings_path).map_err(|error| error.to_string());
        if let Err(reason) = &settings {
            // 起動時の唯一の出力先。フロントにも同じ理由を返す
            eprintln!("canopy: {reason}");
        }
        Self {
            settings_path,
            settings: Mutex::new(settings),
            queue: GitQueue::default(),
        }
    }

    pub fn queue(&self) -> &GitQueue {
        &self.queue
    }

    pub fn settings_path(&self) -> &Path {
        &self.settings_path
    }

    /// Read from the registry.
    pub async fn read<T>(&self, act: impl FnOnce(&Registry) -> T) -> Result<T, StateError> {
        let guard = self.settings.lock().await;
        match guard.as_ref() {
            Ok(registry) => Ok(act(registry)),
            Err(reason) => Err(StateError::Settings(reason.clone())),
        }
    }

    /// Change the registry and save it.
    ///
    /// 保存に失敗したら**変更を戻す**。画面と設定ファイルがずれるのを避ける。
    /// 失敗し得る変更は、クロージャの戻り値に `Result` を入れて呼び出し側で開く。
    pub async fn write<T>(&self, act: impl FnOnce(&mut Registry) -> T) -> Result<T, StateError> {
        let mut guard = self.settings.lock().await;
        let registry = match guard.as_mut() {
            Ok(registry) => registry,
            Err(reason) => return Err(StateError::Settings(reason.clone())),
        };

        let before = registry.clone();
        let value = act(registry);
        if let Err(error) = registry.save(&self.settings_path) {
            *registry = before;
            return Err(StateError::Settings(error.to_string()));
        }
        Ok(value)
    }

    /// Turn a repository id into the directory git may run in.
    pub async fn locate(&self, repo_id: &str) -> Result<Located, StateError> {
        self.read(|registry| {
            let dir = registry.resolve(repo_id)?;
            let name = registry.name_of(repo_id)?.to_owned();
            let common_dir = registry.common_dir_of(repo_id)?;
            Some(Located {
                name,
                dir,
                common_dir,
            })
        })
        .await?
        .ok_or_else(|| StateError::UnknownRepo(UnknownRepo(repo_id.to_owned())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 保存に失敗したらメモリ上の変更も戻す。
    /// 戻さないと画面と設定ファイルが恒久的にずれる
    #[tokio::test]
    async fn rolls_back_when_saving_fails() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temp dir");
        // 読めるが書けない場所に置く。読み込みは「ファイルが無い = 空」で成功し、
        // 保存だけが失敗する
        let locked = directory.path().join("locked");
        std::fs::create_dir(&locked).expect("create dir");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500))
            .expect("make read-only");
        let state = AppState::load(locked.join("canopy.json"));

        let error = state
            .write(|registry| {
                registry.add(
                    "acme-api".to_owned(),
                    PathBuf::from("/repos/acme-api"),
                    PathBuf::from("/repos/acme-api/.git"),
                )
            })
            .await
            .expect_err("save should fail");

        assert!(matches!(error, StateError::Settings(_)), "{error}");
        // 追加が残っていない
        let registrations = state
            .read(|registry| registry.registrations())
            .await
            .expect("read should succeed");
        assert!(registrations.is_empty());

        // 後片付けできるように戻す
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700))
            .expect("restore permissions");
    }

    /// 設定が読めないときは、読み書きの両方が理由を返す
    #[tokio::test]
    async fn refuses_to_work_with_broken_settings() {
        let directory = tempfile::tempdir().expect("temp dir");
        let settings = directory.path().join("canopy.json");
        std::fs::write(&settings, "{ 壊れている").expect("write");
        let state = AppState::load(settings);

        let read = state.read(|registry| registry.registrations()).await;
        let write = state.write(|registry| registry.remove("r1")).await;

        assert!(matches!(read, Err(StateError::Settings(_))));
        assert!(matches!(write, Err(StateError::Settings(_))));
    }

    /// 知らない id は `UnknownRepo` で返す。文言は store 側の 1 箇所
    #[tokio::test]
    async fn reports_an_unknown_id() {
        let directory = tempfile::tempdir().expect("temp dir");
        let state = AppState::load(directory.path().join("canopy.json"));

        let error = state.locate("r404").await.expect_err("unknown id fails");

        assert!(matches!(error, StateError::UnknownRepo(_)), "{error}");
        assert_eq!(error.to_string(), "知らないリポジトリの id です (r404)");
    }
}
