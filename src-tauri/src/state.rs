//! State shared by every command.

use std::fmt;
use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use crate::model::WindowState;
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
    /// Geometry read at startup. 復元は `setup` で 1 回だけ行う。
    initial_window: Option<WindowState>,
    /// Latest geometry after the user moved or resized the window.
    ///
    /// **ここに控えるだけで書き込まない。** `Moved` / `Resized` はドラッグ中に
    /// 何十回も来るので、そのたびに設定ファイルを書くと丸ごと書き直しになる。
    /// 書き出すのは隠したときと終了するとき (docs/adr/0011-residency.md)。
    moved_window: std::sync::Mutex<Option<WindowState>>,
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
        let initial_window = settings.as_ref().ok().and_then(Registry::window);
        Self {
            settings_path,
            settings: Mutex::new(settings),
            queue: GitQueue::default(),
            initial_window,
            moved_window: std::sync::Mutex::new(None),
        }
    }

    /// Where the window was when the app last exited.
    pub fn initial_window(&self) -> Option<WindowState> {
        self.initial_window
    }

    /// Remember where the window is now. **設定ファイルには書かない。**
    pub fn record_window(&self, window: WindowState) {
        *self.moved() = Some(window);
    }

    /// Write the remembered geometry. 動いていなければ何もしない。
    ///
    /// **失敗したら控えを残す。** 消すと、書けなかった位置が次の機会にも
    /// 保存されない。
    pub async fn save_window(&self) -> Result<(), StateError> {
        let Some(window) = *self.moved() else {
            return Ok(());
        };
        self.write(|registry| registry.set_window(window)).await?;
        // 待っている間に動いていたら、その値を残す
        let mut moved = self.moved();
        if *moved == Some(window) {
            *moved = None;
        }
        Ok(())
    }

    fn moved(&self) -> std::sync::MutexGuard<'_, Option<WindowState>> {
        self.moved_window
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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

    fn geometry(x: f64, y: f64, width: f64, height: f64) -> WindowState {
        WindowState {
            x,
            y,
            width,
            height,
        }
    }

    /// 設定ファイルから読んだウィンドウの位置とサイズを返す。
    /// 復元は `setup` が 1 回だけ使う (docs/adr/0011-residency.md)
    #[tokio::test]
    async fn reads_the_window_geometry_at_startup() {
        let directory = tempfile::tempdir().expect("temp dir");
        let settings = directory.path().join("canopy.json");
        let before = AppState::load(settings.clone());
        before.record_window(geometry(120.0, 80.0, 1180.0, 760.0));
        before.save_window().await.expect("save should succeed");

        let after = AppState::load(settings);

        assert_eq!(
            after.initial_window(),
            Some(geometry(120.0, 80.0, 1180.0, 760.0))
        );
    }

    /// 保存する前は設定ファイルに書かれていない。
    /// **`Moved` はドラッグ中に何十回も来る**ので、そのたびには書かない
    #[tokio::test]
    async fn does_not_write_the_geometry_until_it_is_saved() {
        let directory = tempfile::tempdir().expect("temp dir");
        let settings = directory.path().join("canopy.json");
        let state = AppState::load(settings.clone());

        state.record_window(geometry(120.0, 80.0, 1180.0, 760.0));

        assert!(!settings.exists(), "控えただけで書き込んでいる");
    }

    /// 動いていなければ書かない。書き込めない場所でも成功する
    #[tokio::test]
    async fn does_not_write_when_the_window_has_not_moved() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temp dir");
        let state = AppState::load(directory.path().join("canopy.json"));
        state.record_window(geometry(120.0, 80.0, 1180.0, 760.0));
        state.save_window().await.expect("the first save writes");

        // 以降の保存が本当に書いていないなら、書けない場所でも成功する
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o500))
            .expect("make read-only");
        let again = state.save_window().await;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))
            .expect("restore permissions");

        assert!(again.is_ok(), "動いていないのに書き込んでいる");
    }

    /// 保存に失敗したら控えを残す。次の機会に書けるようにする
    #[tokio::test]
    async fn keeps_the_geometry_when_saving_fails() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temp dir");
        let locked = directory.path().join("locked");
        std::fs::create_dir(&locked).expect("create dir");
        let settings = locked.join("canopy.json");
        let state = AppState::load(settings.clone());
        state.record_window(geometry(120.0, 80.0, 1180.0, 760.0));
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500))
            .expect("make read-only");

        let failed = state.save_window().await;

        assert!(failed.is_err(), "書けないのに成功している");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700))
            .expect("restore permissions");
        state.save_window().await.expect("the retry writes");
        assert_eq!(
            AppState::load(settings).initial_window(),
            Some(geometry(120.0, 80.0, 1180.0, 760.0)),
            "控えが捨てられている"
        );
    }

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
