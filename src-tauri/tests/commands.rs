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
use tauri::test::{INVOKE_KEY, MockRuntime, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;
use tauri::{Listener, Manager};

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

/// `checkout_branch` の引数名は `name`。戻り値は `{ result, snapshot }` の 1 つ
#[tokio::test]
async fn checks_out_a_branch_through_the_ipc() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["branch", "topic"]).await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let outcome = invoke(
        &app,
        "checkout_branch",
        json!({ "repo_id": &id, "name": "topic" }),
    )
    .expect("checkout_branch should answer");

    assert_eq!(outcome["result"]["ok"], json!(true));
    assert_eq!(outcome["snapshot"]["head"]["name"], json!("topic"));
    // 2 回目の invoke を投げさせない (docs/adr/0009-concurrency-and-refresh.md)
    assert!(outcome["snapshot"]["revision"].is_number());
}

/// `rename_branch` の引数名は `name` と `new_name`
#[tokio::test]
async fn renames_a_branch_through_the_ipc() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let outcome = invoke(
        &app,
        "rename_branch",
        json!({ "repo_id": &id, "name": "main", "new_name": "trunk" }),
    )
    .expect("rename_branch should answer");

    assert_eq!(outcome["result"]["ok"], json!(true));
    assert_eq!(outcome["snapshot"]["head"]["name"], json!("trunk"));
}

/// git の非ゼロ終了は `Err` ではなく結果として返る。**出力を捨てない**
#[tokio::test]
async fn returns_a_failed_operation_as_a_result() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let outcome = invoke(
        &app,
        "checkout_branch",
        json!({ "repo_id": &id, "name": "does-not-exist" }),
    )
    .expect("a failed operation is still an answer");

    assert_eq!(outcome["result"]["ok"], json!(false));
    assert!(outcome["result"]["message"].is_string());
    assert!(
        !outcome["result"]["steps"][0]["stderr"]
            .as_str()
            .expect("stderr is a string")
            .is_empty(),
        "コンソールに出す出力が消えている"
    );
}

/// **参照名の検証は IPC 越しでも通る。** `-f` は `Err` で止める
#[tokio::test]
async fn rejects_a_branch_name_that_is_an_option_through_the_ipc() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let error = invoke(
        &app,
        "checkout_branch",
        json!({ "repo_id": &id, "name": "-f" }),
    )
    .expect_err("an option must not reach git");

    assert_eq!(
        error,
        json!("`-` で始まる名前は使えません (-f)"),
        "フロントに出す文言が変わっている"
    );
}

/// `get_push_preview` の引数名は `repo_id` と `branch`
#[tokio::test]
async fn reads_the_push_preview_through_the_ipc() {
    let fixture = Fixture::new().await;
    fixture.commit("second").await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let preview = invoke(
        &app,
        "get_push_preview",
        json!({ "repo_id": &id, "branch": "main" }),
    )
    .expect("get_push_preview should answer");

    assert_eq!(preview["branch"], json!("main"));
    assert_eq!(preview["upstream"], json!("origin/main"));
    assert_eq!(preview["ahead"][0]["subject"], json!("second"));
    assert!(preview["remote_sha"].is_string());
}

/// `fetch_all` は「これから取りに行く id」を返す。結果はイベントで届く
#[tokio::test]
async fn answers_with_the_ids_a_bulk_fetch_covers() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let ids = invoke(&app, "fetch_all", json!({})).expect("fetch_all should answer");

    assert_eq!(ids, json!([id]));
}

/// **一括フェッチはイベントを送る。**
///
/// 結果の届け先はイベントだけ。1 通も送らないと、フロントは `fetch_all` が
/// 返した id 全部に実行中の印を付けたまま待ち続け、そのリポジトリの操作系が
/// 永久に無効になる (docs/adr/0009-concurrency-and-refresh.md)
#[tokio::test]
async fn emits_an_event_for_every_repository_it_fetched() {
    let fixture = Fixture::new().await;
    let directory = tempfile::tempdir().expect("temp dir");
    let settings = directory.path().join("canopy.json");
    let (registry, id) = fixture.register(fixture.work()).await;
    registry.save(&settings).expect("save should succeed");
    let app = build_app(&settings);

    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let collected = std::sync::Arc::clone(&seen);
    app.listen("repo_snapshot_updated", move |event| {
        let payload: Value = serde_json::from_str(event.payload()).expect("payload is JSON");
        collected
            .lock()
            .expect("the log is never poisoned")
            .push(payload);
    });

    invoke(&app, "fetch_all", json!({})).expect("fetch_all should answer");

    // 送出は spawn した先で起きるので、届くまで待つ
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if !seen.lock().expect("the log is never poisoned").is_empty() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "repo_snapshot_updated が 1 通も届かない"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let events = seen.lock().expect("the log is never poisoned");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["repo_id"], json!(id));
    assert_eq!(events[0]["error"], Value::Null);
    assert_eq!(events[0]["outcome"]["result"]["ok"], json!(true));
    assert_eq!(events[0]["outcome"]["snapshot"]["id"], json!(id));
}
