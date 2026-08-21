//! IPC の境界を通して呼ぶ。
//!
//! コマンドのラッパは手書きなので、引数名の間違いは型では防げない。
//! ここで縛る (docs/adr/0013-type-generation.md)。
//!
//! `add_repo` は OS のフォルダ選択を開くのでここでは呼べない。
//! 名前の突き合わせは `src/ipc/commands.test.ts` が `lib.rs` を読んで行う。

mod support;

use std::path::Path;

use serde_json::{Value, json};
use tauri::Manager;
use tauri::test::{INVOKE_KEY, MockRuntime, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;

use support::Fixture;

/// Build an app whose commands are exactly the ones `run()` registers.
fn build_app(settings: &Path) -> tauri::App<MockRuntime> {
    let app = mock_builder()
        .invoke_handler(canopy_lib::invoke_handler())
        .build(mock_context(noop_assets()))
        .expect("the mock app should build");
    app.manage(canopy_lib::state::AppState::load(settings.to_owned()));
    // mock_context の設定にはウィンドウが無いので、ここで作る
    tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
        .build()
        .expect("the main webview should build");
    app
}

/// Call a command the way the frontend does.
fn invoke(app: &tauri::App<MockRuntime>, command: &str, body: Value) -> Result<Value, Value> {
    let webview = app.get_webview_window("main").expect("main webview exists");
    tauri::test::get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: command.to_owned(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            // 本番と同じ origin。http:// にすると ACL が外部由来と見なして弾く
            url: "tauri://localhost".parse().expect("url"),
            body: body.into(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_owned(),
        },
    )
    .map(|response| response.deserialize().expect("response should deserialize"))
}

/// 登録が無いうちは空の一覧と既定の UI 状態を返す
#[tokio::test]
async fn answers_with_an_empty_list_at_first() {
    let directory = tempfile::tempdir().expect("temp dir");
    let app = build_app(&directory.path().join("canopy.json"));

    let repos = invoke(&app, "list_repos", json!({})).expect("list_repos should answer");
    let ui_state = invoke(&app, "get_ui_state", json!({})).expect("get_ui_state should answer");

    assert_eq!(repos, json!([]));
    assert_eq!(ui_state["pane_width"], json!(360));
    assert_eq!(ui_state["group_directories"], json!(true));
    assert_eq!(ui_state["local_only"], json!(false));
    assert_eq!(ui_state["expanded"], json!([]));
}

/// `save_ui_state` の引数名は `ui_state`。camelCase にすると届かない
#[tokio::test]
async fn saves_and_reads_back_the_ui_state() {
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let app = build_app(&settings);
    let ui_state = json!({
        "repo_order": [],
        "expanded": ["r1|repo|"],
        "pane_width": 420,
        "console_open": true,
        "window": null,
        "group_directories": false,
        "local_only": true,
    });

    invoke(&app, "save_ui_state", json!({ "ui_state": ui_state }))
        .expect("save_ui_state should answer");

    // 保存したファイルを読み直したアプリでも同じ値になる
    let reopened = build_app(&settings);
    let read = invoke(&reopened, "get_ui_state", json!({})).expect("get_ui_state should answer");
    assert_eq!(read["pane_width"], json!(420));
    assert_eq!(read["console_open"], json!(true));
    assert_eq!(read["group_directories"], json!(false));
    assert_eq!(read["local_only"], json!(true));
    // 存在しないリポジトリのキーは読み込み時に捨てる
    assert_eq!(read["expanded"], json!([]));
}

/// `get_repo_snapshot` の引数名は `repo_id`。スナップショットが JSON で返る
#[tokio::test]
async fn reads_a_snapshot_through_the_ipc() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    // 登録は store 側で作ってから、同じファイルを読ませる
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let snapshot = invoke(&app, "get_repo_snapshot", json!({ "repo_id": id }))
        .expect("get_repo_snapshot should answer");

    assert_eq!(snapshot["id"], json!(id));
    assert_eq!(snapshot["name"], json!("work"));
    assert_eq!(snapshot["head"]["kind"], json!("branch"));
    assert_eq!(snapshot["head"]["name"], json!("main"));
    assert_eq!(snapshot["local"][0]["name"], json!("main"));
    assert_eq!(snapshot["local"][0]["is_current"], json!(true));
    assert_eq!(snapshot["revision"], json!(1));
    // 表示用にパスは返す (docs/security.md)
    assert!(snapshot["path"].is_string());
}

/// 世代は呼ぶたびに増える。フロントが古いものを捨てるための番号
/// (docs/adr/0009-concurrency-and-refresh.md)
#[tokio::test]
async fn increases_the_revision_on_every_read() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let first = invoke(&app, "get_repo_snapshot", json!({ "repo_id": &id })).expect("first");
    let second = invoke(&app, "get_repo_snapshot", json!({ "repo_id": &id })).expect("second");

    assert_eq!(first["revision"], json!(1));
    assert_eq!(second["revision"], json!(2));
}

/// 知らない id は、そのリポジトリだけのエラーとして文字列で返る
#[tokio::test]
async fn rejects_an_unknown_repository_id() {
    let directory = tempfile::tempdir().expect("temp dir");
    let app = build_app(&directory.path().join("canopy.json"));

    let error = invoke(&app, "get_repo_snapshot", json!({ "repo_id": "r404" }))
        .expect_err("unknown id should fail");

    assert_eq!(
        error,
        json!("知らないリポジトリの id です (r404)"),
        "フロントに出す文言が変わっている"
    );
}

/// `remove_repo` は一覧から消す。ディスクには触らない
#[tokio::test]
async fn removes_a_repository_from_the_list() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    invoke(&app, "remove_repo", json!({ "repo_id": &id })).expect("remove_repo should answer");

    assert_eq!(
        invoke(&app, "list_repos", json!({})).expect("list_repos should answer"),
        json!([])
    );
    assert!(
        fixture.work().exists(),
        "ディスクのリポジトリを消してはいけない"
    );
}

/// 並び順は `save_ui_state` の `repo_order` で保存する。専用のコマンドは持たない
#[tokio::test]
async fn saves_the_repository_order_with_the_ui_state() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let second = fixture.root().join("second");
    std::fs::create_dir_all(&second).expect("create dir");
    fixture.git(&second, &["init", "-b", "main"]).await;
    let (mut registry, first_id) = fixture.register(fixture.work()).await;
    let second_id = fixture
        .add_to(&mut registry, &second)
        .await
        .expect("second repository registers");
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let ui_state = invoke(&app, "get_ui_state", json!({})).expect("get_ui_state should answer");
    let mut reordered = ui_state.clone();
    reordered["repo_order"] = json!([&second_id, &first_id]);
    invoke(&app, "save_ui_state", json!({ "ui_state": reordered }))
        .expect("save_ui_state should answer");

    let repos = invoke(&app, "list_repos", json!({})).expect("list_repos should answer");
    assert_eq!(repos[0]["id"], json!(second_id));
    assert_eq!(repos[1]["id"], json!(first_id));
}

/// 知らない id が混ざっていても、登録済みのリポジトリは消えない
#[tokio::test]
async fn drops_unknown_ids_from_a_saved_order() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let mut ui_state = invoke(&app, "get_ui_state", json!({})).expect("get_ui_state should answer");
    ui_state["repo_order"] = json!(["r404", &id]);
    invoke(&app, "save_ui_state", json!({ "ui_state": ui_state }))
        .expect("save_ui_state should answer");

    let repos = invoke(&app, "list_repos", json!({})).expect("list_repos should answer");
    assert_eq!(repos.as_array().map(Vec::len), Some(1));
    assert_eq!(repos[0]["id"], json!(id));
}

/// 設定ファイルが壊れているときは、初期状態で上書きせずに理由を返す
/// (docs/adr/0016-store-without-plugin.md)
#[tokio::test]
async fn refuses_to_work_with_a_broken_settings_file() {
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    std::fs::write(&settings, "{ 壊れている").expect("write");
    let app = build_app(&settings);

    let error = invoke(&app, "list_repos", json!({})).expect_err("should fail");

    assert!(
        error
            .as_str()
            .expect("error is a string")
            .contains("設定の中身が壊れています"),
        "{error}"
    );
    // 壊れたファイルはそのまま残る
    assert_eq!(
        std::fs::read_to_string(&settings).expect("read"),
        "{ 壊れている"
    );
}
