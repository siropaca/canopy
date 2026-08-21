//! 実物のリポジトリに書き込む。
//!
//! **破壊的な操作をテストするので、必ず一時リポジトリに対して実行する**
//! (docs/testing.md)。ユーザーの実リポジトリは触らない。
//!
//! 呼ぶのは `canopy_lib::ops` の合成関数。コマンドの薄いラッパを通さずに、
//! 「locate → ロック → 実行 → 取り直し」の順序ごと検証する。

mod support;

use std::time::Duration;

use canopy_lib::git::Operation;
use canopy_lib::model::{HeadKind, OpOutcome};
use canopy_lib::ops;
use canopy_lib::queue::{NETWORK_LIMIT, READ_LIMIT};
use canopy_lib::state::AppState;

use support::Fixture;

/// Run one operation and require the app side not to fail.
async fn run(state: &AppState, id: &str, op: Operation) -> OpOutcome {
    ops::run(state, id, &op)
        .await
        .expect("the app side should not fail")
}

/// The snapshot an operation took again. **取り直しは必ず成功する前提のテスト用。**
fn snapshot_of(outcome: &OpOutcome) -> &canopy_lib::model::RepoSnapshot {
    outcome
        .snapshot
        .as_ref()
        .unwrap_or_else(|| panic!("取り直しに失敗した: {:?}", outcome.snapshot_error))
}

/// The message a failed operation shows.
fn message(outcome: &OpOutcome) -> &str {
    outcome
        .result
        .message
        .as_deref()
        .expect("a failed operation carries a message")
}

/// チェックアウトが成功して、**返ってきたスナップショットが新しい HEAD を指す**
#[tokio::test]
async fn checks_out_a_local_branch_and_returns_the_new_state() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["branch", "topic"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Checkout {
            name: "topic".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(snapshot_of(&outcome).head.kind, HeadKind::Branch);
    assert_eq!(snapshot_of(&outcome).head.name, "topic");
    assert_eq!(outcome.result.steps.len(), 1);
    assert_eq!(
        outcome.result.steps[0].command,
        "git switch --end-of-options topic"
    );
}

/// **参照名は必ず検証を通る。** `-f` の 1 発で `git checkout -f` になり、
/// ワークツリーの未コミット変更が全部消える (docs/security.md)
#[tokio::test]
async fn refuses_a_branch_name_that_is_an_option() {
    let fixture = Fixture::new().await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    for name in ["-f", "--force", "@{-1}", "main..topic", ""] {
        let error = ops::run(
            &state,
            &ids[0],
            &Operation::Checkout {
                name: name.to_owned(),
            },
        )
        .await
        .expect_err(&format!("{name:?} は検証で弾かれる"));

        assert!(
            error.to_string().contains("使えません") || error.to_string().contains("空です"),
            "{name:?}: {error}"
        );
    }
    // 未コミットの変更が残っている (git が走っていない証拠)
    fixture.write("dirty.txt", "x");
    let after = ops::read_snapshot(&state, &ids[0])
        .await
        .expect("snapshot should build");
    assert_eq!(after.changes.total, 1);
}

/// 名前の変更のあと追跡先を外す。外さないと origin 側に旧名と新名が両方できる
#[tokio::test]
async fn renames_a_branch_and_drops_the_upstream_it_kept() {
    let fixture = Fixture::new().await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Rename {
            from: "main".to_owned(),
            to: "trunk".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(
        outcome.result.steps.len(),
        2,
        "`branch -m` と `branch --unset-upstream` の 2 本"
    );
    let renamed = snapshot_of(&outcome)
        .local
        .iter()
        .find(|branch| branch.name == "trunk")
        .expect("the new name is in the snapshot");
    assert_eq!(
        renamed.upstream, None,
        "追跡先が残っていると旧名にプッシュする"
    );
    assert_eq!(snapshot_of(&outcome).head.name, "trunk");
}

/// 追跡先が無いブランチの名前変更は 1 本で終わる。
/// `--unset-upstream` を撃つと「上流が無い」で失敗する
#[tokio::test]
async fn renames_a_branch_without_an_upstream_in_one_command() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["branch", "solo"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Rename {
            from: "solo".to_owned(),
            to: "solo-2".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(outcome.result.steps.len(), 1);
}

/// 未コミットがある状態でプルすると失敗する。**自動で stash しない**
#[tokio::test]
async fn refuses_to_pull_with_uncommitted_changes() {
    let fixture = Fixture::new().await;
    let other = fixture.other_clone("other").await;
    fixture.commit_in(&other, "remote.txt", "from other").await;
    fixture.git(&other, &["push", "origin", "main"]).await;
    fixture.write("first", "手元で書き換えた");
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(&state, &ids[0], Operation::PullCurrent).await;

    assert!(!outcome.result.ok);
    assert_eq!(
        message(&outcome),
        "プルに失敗しました (未コミットの変更あり)"
    );
    // 失敗しても出力は残す
    assert!(!outcome.result.steps.is_empty());
    // 取り直した状態に未コミットが出ている
    assert_eq!(snapshot_of(&outcome).changes.total, 1);
}

/// behind と ahead があるブランチのプッシュは拒否される
#[tokio::test]
async fn rejects_a_push_when_the_remote_moved_on() {
    let fixture = Fixture::new().await;
    let other = fixture.other_clone("other").await;
    fixture.commit_in(&other, "remote.txt", "from other").await;
    fixture.git(&other, &["push", "origin", "main"]).await;
    fixture.commit("local.txt").await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Push {
            branch: "main".to_owned(),
            force_with_lease: None,
        },
    )
    .await;

    assert!(!outcome.result.ok);
    assert_eq!(
        message(&outcome),
        "プッシュが拒否されました (リモートが先に進んでいます)",
        "**プルの文言を出してはいけない**"
    );
}

/// 早送りできないときは失敗する。**プッシュの文言を出さない**
#[tokio::test]
async fn refuses_to_fast_forward_a_diverged_branch() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "topic"]).await;
    fixture.work_git(&["push", "-u", "origin", "topic"]).await;
    let other = fixture.other_clone("other").await;
    fixture.git(&other, &["switch", "topic"]).await;
    fixture.commit_in(&other, "remote.txt", "from other").await;
    fixture.git(&other, &["push", "origin", "topic"]).await;
    // 手元にもコミットを積んで分岐させる
    fixture.commit("local.txt").await;
    fixture.work_git(&["switch", "main"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::FastForward {
            branch: "topic".to_owned(),
        },
    )
    .await;

    assert!(!outcome.result.ok);
    assert_eq!(
        message(&outcome),
        "早送りできません (手元にコミットがあります)",
        "**プッシュの文言を出してはいけない** (同じ (non-fast-forward))"
    );
}

/// 早送りできるときは、チェックアウトせずに進む
#[tokio::test]
async fn fast_forwards_a_branch_without_checking_it_out() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "topic"]).await;
    fixture.work_git(&["push", "-u", "origin", "topic"]).await;
    fixture.work_git(&["switch", "main"]).await;
    let other = fixture.other_clone("other").await;
    fixture.git(&other, &["switch", "topic"]).await;
    fixture.commit_in(&other, "remote.txt", "from other").await;
    fixture.git(&other, &["push", "origin", "topic"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::FastForward {
            branch: "topic".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(
        snapshot_of(&outcome).head.name,
        "main",
        "チェックアウトはしない"
    );
    let topic = snapshot_of(&outcome)
        .local
        .iter()
        .find(|branch| branch.name == "topic")
        .expect("topic is in the snapshot");
    assert_eq!(topic.behind, 0);
    assert_eq!(topic.ahead, 0);
}

/// 追跡先が `origin` ではないブランチも、その追跡先から取る。
/// `origin` 決め打ちだと**別のブランチの中身で上書きする**
#[tokio::test]
async fn fast_forwards_from_the_upstream_remote_not_origin() {
    let fixture = Fixture::new().await;
    // fork を模す。`upstream` に別の bare を置いて、そこを追跡させる
    let upstream = fixture.root().join("upstream.git");
    fixture
        .git(
            fixture.root(),
            &["init", "--bare", "-b", "main", "upstream.git"],
        )
        .await;
    fixture.work_git(&["branch", "topic"]).await;
    fixture
        .work_git(&[
            "remote",
            "add",
            "upstream",
            upstream.to_str().expect("path"),
        ])
        .await;
    fixture.work_git(&["push", "-u", "upstream", "topic"]).await;
    // origin 側の topic だけを別のコミットで先に進める
    let other = fixture.other_clone("other").await;
    fixture.commit_in(&other, "origin-only.txt", "origin").await;
    fixture.git(&other, &["push", "origin", "main:topic"]).await;
    // upstream 側の topic を進める
    let forked = fixture.root().join("forked");
    fixture
        .git(fixture.root(), &["clone", "upstream.git", "forked"])
        .await;
    fixture
        .git(&forked, &["config", "user.email", "f@example.com"])
        .await;
    fixture.git(&forked, &["config", "user.name", "Fork"]).await;
    fixture.git(&forked, &["switch", "topic"]).await;
    fixture
        .commit_in(&forked, "upstream-only.txt", "upstream")
        .await;
    // `forked` は upstream.git のクローンなので、そのリモート名は origin
    fixture.git(&forked, &["push", "origin", "topic"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::FastForward {
            branch: "topic".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert!(
        outcome.result.steps[0].command.contains(" upstream "),
        "追跡先のリモートから取る: {}",
        outcome.result.steps[0].command
    );
    let files = fixture
        .git(fixture.work(), &["ls-tree", "--name-only", "topic"])
        .await;
    assert!(files.contains("upstream-only.txt"), "{files}");
    assert!(!files.contains("origin-only.txt"), "{files}");
}

/// ローカルに無いリモートブランチは、追跡ブランチを作って切り替える
#[tokio::test]
async fn creates_a_tracking_branch_for_a_remote_only_branch() {
    let fixture = Fixture::new().await;
    let other = fixture.other_clone("other").await;
    fixture.git(&other, &["switch", "-c", "remote-only"]).await;
    fixture.commit_in(&other, "r.txt", "r").await;
    fixture
        .git(&other, &["push", "-u", "origin", "remote-only"])
        .await;
    fixture.work_git(&["fetch"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Checkout {
            name: "origin/remote-only".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(snapshot_of(&outcome).head.name, "remote-only");
    let created = snapshot_of(&outcome)
        .local
        .iter()
        .find(|branch| branch.name == "remote-only")
        .expect("the tracking branch is in the snapshot");
    assert_eq!(created.upstream.as_deref(), Some("origin/remote-only"));
}

/// 同名のローカルがあると切り替わるだけ。**リモートの先端には乗らない。**
/// 黙って成功させると「プルしたつもり」になる
#[tokio::test]
async fn says_so_when_a_remote_checkout_only_switches_to_the_local_branch() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "topic"]).await;
    fixture.work_git(&["push", "-u", "origin", "topic"]).await;
    fixture.work_git(&["switch", "main"]).await;
    let other = fixture.other_clone("other").await;
    fixture.git(&other, &["switch", "topic"]).await;
    fixture.commit_in(&other, "ahead.txt", "ahead").await;
    fixture.git(&other, &["push", "origin", "topic"]).await;
    fixture.work_git(&["fetch"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Checkout {
            name: "origin/topic".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(snapshot_of(&outcome).head.name, "topic");
    assert_eq!(
        message(&outcome),
        "既存のローカルブランチ topic に切り替えました (リモートの先端には乗りません)"
    );
    let topic = snapshot_of(&outcome)
        .local
        .iter()
        .find(|branch| branch.name == "topic")
        .expect("topic is in the snapshot");
    assert_eq!(topic.behind, 1, "リモートの先端には乗っていない");
}

/// タグは detached でチェックアウトする。同名のブランチに逃げない
#[tokio::test]
async fn checks_out_a_tag_as_a_detached_head() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["tag", "v1.0"]).await;
    fixture.commit("second").await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::CheckoutTag {
            tag: "v1.0".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(snapshot_of(&outcome).head.kind, HeadKind::Detached);
    assert_eq!(snapshot_of(&outcome).head.name, "v1.0");
    assert!(
        outcome.result.steps[0].command.contains("refs/tags/v1.0"),
        "{}",
        outcome.result.steps[0].command
    );
}

/// detached HEAD から直前のブランチへ戻る。無いとタグを開いた時点で戻れない
#[tokio::test]
async fn goes_back_to_the_previous_branch() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["tag", "v1.0"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;
    let detached = run(
        &state,
        &ids[0],
        Operation::CheckoutTag {
            tag: "v1.0".to_owned(),
        },
    )
    .await;
    assert_eq!(snapshot_of(&detached).head.kind, HeadKind::Detached);

    let outcome = run(&state, &ids[0], Operation::Previous).await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(snapshot_of(&outcome).head.kind, HeadKind::Branch);
    assert_eq!(snapshot_of(&outcome).head.name, "main");
}

/// `⧉` が付いたブランチのチェックアウトは必ず失敗する。パスを添えて見せる
#[tokio::test]
async fn names_the_worktree_that_already_holds_the_branch() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["branch", "held"]).await;
    let worktree = fixture.root().join("held-wt");
    fixture
        .work_git(&["worktree", "add", worktree.to_str().expect("path"), "held"])
        .await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Checkout {
            name: "held".to_owned(),
        },
    )
    .await;

    assert!(!outcome.result.ok);
    assert!(
        message(&outcome).starts_with("別のワークツリーで使用中です"),
        "{}",
        message(&outcome)
    );
    assert!(
        message(&outcome).contains("held-wt"),
        "{}",
        message(&outcome)
    );
}

/// `⧉` が付いたブランチのプルは、**そのワークツリーで**実行する
#[tokio::test]
async fn pulls_a_branch_inside_the_worktree_that_holds_it() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "held"]).await;
    fixture.work_git(&["push", "-u", "origin", "held"]).await;
    fixture.work_git(&["switch", "main"]).await;
    let worktree = fixture.root().join("held-wt");
    fixture
        .work_git(&["worktree", "add", worktree.to_str().expect("path"), "held"])
        .await;
    let other = fixture.other_clone("other").await;
    fixture.git(&other, &["switch", "held"]).await;
    fixture.commit_in(&other, "remote.txt", "from other").await;
    fixture.git(&other, &["push", "origin", "held"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::FastForward {
            branch: "held".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(
        outcome.result.steps[0].command, "git pull --rebase",
        "早送りではなく、そのワークツリーでプルする"
    );
    assert!(
        worktree.join("remote.txt").exists(),
        "ワークツリーの中身が進んでいる"
    );
}

/// 強制プッシュはユーザーが**画面で見ていた sha** を基準にする。
/// フェッチしてからでもリースが効く (docs/specs/git-operations.md)
#[tokio::test]
async fn refuses_a_force_push_whose_lease_is_stale() {
    let fixture = Fixture::new().await;
    let seen = fixture
        .work_git(&["rev-parse", "refs/remotes/origin/main"])
        .await
        .trim()
        .to_owned();
    // 同僚が origin を進める
    let other = fixture.other_clone("other").await;
    fixture.commit_in(&other, "theirs.txt", "theirs").await;
    fixture.git(&other, &["push", "origin", "main"]).await;
    // こちらは履歴を書き換えて、フェッチもする
    fixture
        .work_git(&["commit", "--amend", "-m", "amended"])
        .await;
    fixture.work_git(&["fetch"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Push {
            branch: "main".to_owned(),
            force_with_lease: Some(seen),
        },
    )
    .await;

    assert!(!outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(
        message(&outcome),
        "リモートが更新されています。フェッチしてやり直してください"
    );
    // 同僚のコミットが残っている
    let log = fixture
        .git(fixture.origin(), &["log", "--format=%s", "main"])
        .await;
    assert!(log.contains("theirs.txt"), "{log}");
}

/// リースが合っていれば強制プッシュは通る
#[tokio::test]
async fn force_pushes_when_the_lease_matches() {
    let fixture = Fixture::new().await;
    fixture
        .work_git(&["commit", "--amend", "-m", "amended"])
        .await;
    let seen = fixture
        .work_git(&["rev-parse", "refs/remotes/origin/main"])
        .await
        .trim()
        .to_owned();
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Push {
            branch: "main".to_owned(),
            force_with_lease: Some(seen.clone()),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert!(
        outcome.result.steps[0]
            .command
            .contains(&format!("--force-with-lease=main:{seen}")),
        "sha を明示する: {}",
        outcome.result.steps[0].command
    );
    let log = fixture
        .git(fixture.origin(), &["log", "--format=%s", "main"])
        .await;
    assert!(log.contains("amended"), "{log}");
}

/// 16 進数以外の sha は通さない
#[tokio::test]
async fn refuses_a_lease_that_is_not_a_sha() {
    let fixture = Fixture::new().await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let error = ops::run(
        &state,
        &ids[0],
        &Operation::Push {
            branch: "main".to_owned(),
            force_with_lease: Some("HEAD~1".to_owned()),
        },
    )
    .await
    .expect_err("sha として読めない値は弾く");

    assert!(
        error.to_string().contains("sha として読めません"),
        "{error}"
    );
}

/// 追跡ブランチが無いときは `-u` で作る
#[tokio::test]
async fn creates_the_upstream_on_the_first_push() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "fresh"]).await;
    fixture.commit("fresh.txt").await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Push {
            branch: "fresh".to_owned(),
            force_with_lease: None,
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert!(
        outcome.result.steps[0].command.contains("push -u"),
        "{}",
        outcome.result.steps[0].command
    );
    let pushed = snapshot_of(&outcome)
        .local
        .iter()
        .find(|branch| branch.name == "fresh")
        .expect("fresh is in the snapshot");
    assert_eq!(pushed.upstream.as_deref(), Some("origin/fresh"));
    assert_eq!(pushed.ahead, 0);
}

/// **後半が失敗しても、前半の結果は画面に出す。**
/// 取り直さないと「画面は元のブランチ・実態は rebase 中」になる
#[tokio::test]
async fn keeps_the_switch_visible_when_the_pull_after_it_fails() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "topic"]).await;
    fixture.work_git(&["push", "-u", "origin", "topic"]).await;
    let other = fixture.other_clone("other").await;
    fixture.git(&other, &["switch", "topic"]).await;
    fixture.commit_in(&other, "both.txt", "theirs").await;
    fixture.git(&other, &["push", "origin", "topic"]).await;
    fixture.commit_in(fixture.work(), "both.txt", "ours").await;
    fixture.work_git(&["switch", "main"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::CheckoutAndPull {
            name: "topic".to_owned(),
        },
    )
    .await;

    assert!(!outcome.result.ok);
    assert_eq!(
        outcome.result.steps.len(),
        2,
        "両方の出力を残す (docs/specs/git-operations.md)"
    );
    assert_eq!(message(&outcome), "競合しました。手元で解決してください");
    assert_ne!(
        snapshot_of(&outcome).head.name,
        "main",
        "**元のブランチのまま見せてはいけない**"
    );
}

/// 前半が失敗したら止める。プルは走らせない
#[tokio::test]
async fn stops_before_pulling_when_the_switch_fails() {
    let fixture = Fixture::new().await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::CheckoutAndPull {
            name: "does-not-exist".to_owned(),
        },
    )
    .await;

    assert!(!outcome.result.ok);
    assert_eq!(outcome.result.steps.len(), 1, "プルまで進んではいけない");
    assert_eq!(snapshot_of(&outcome).head.name, "main");
}

/// 同一リポジトリに操作を連続で投げても `index.lock` の失敗が出ない
#[tokio::test]
async fn never_collides_on_the_index_lock() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["branch", "topic"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;
    let id = ids[0].clone();

    let to_topic = Operation::Checkout {
        name: "topic".to_owned(),
    };
    let to_main = Operation::Checkout {
        name: "main".to_owned(),
    };
    let outcomes = tokio::join!(
        ops::run(&state, &id, &Operation::Fetch),
        ops::run(&state, &id, &to_topic),
        ops::run(&state, &id, &Operation::PullCurrent),
        ops::run(&state, &id, &to_main),
        ops::read_snapshot(&state, &id),
        ops::read_snapshot(&state, &id),
    );

    let results = [
        outcomes.0.expect("fetch"),
        outcomes.1.expect("checkout topic"),
        outcomes.2.expect("pull"),
        outcomes.3.expect("checkout main"),
    ];
    for outcome in &results {
        for step in &outcome.result.steps {
            let text = format!("{}{}", step.stderr, step.stdout);
            assert!(
                !text.contains("index.lock") && !text.contains("Unable to create"),
                "ロックが競合した: {} -> {text}",
                step.command
            );
        }
    }
    outcomes.4.expect("read");
    outcomes.5.expect("read");
    // 世代は重複しない。フロントが古いものを捨てる基準になる
    let mut revisions: Vec<u64> = results
        .iter()
        .map(|outcome| snapshot_of(outcome).revision)
        .collect();
    revisions.sort_unstable();
    revisions.dedup();
    assert_eq!(revisions.len(), results.len(), "世代が重複している");
}

/// 同種操作は重ねない。**フェッチ連打で 11 本積まれない**
#[tokio::test]
async fn skips_a_second_fetch_that_is_already_running() {
    let fixture = Fixture::new().await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;
    let id = ids[0].clone();

    let (first, second) = tokio::join!(
        ops::run(&state, &id, &Operation::Fetch),
        ops::run(&state, &id, &Operation::Fetch),
    );

    let first = first.expect("first fetch");
    let second = second.expect("second fetch");
    let skipped = [&first, &second]
        .into_iter()
        .filter(|outcome| outcome.result.steps.is_empty())
        .count();
    assert_eq!(skipped, 1, "1 本だけ走って、もう 1 本は省略される");
    for outcome in [&first, &second] {
        if outcome.result.steps.is_empty() {
            assert_eq!(
                outcome.result.message.as_deref(),
                Some("同じ操作を実行中です")
            );
        }
    }
}

/// 一括フェッチは 1 件ずつ結果を返す。壊れたリポジトリで全体を止めない
#[tokio::test]
async fn fetches_repositories_one_by_one() {
    let fixture = Fixture::new().await;
    let second = fixture.other_clone("second").await;
    let (state, ids) = fixture.state(&[fixture.work(), &second]).await;

    let first = ops::fetch_in_bulk(&state, &ids[0])
        .await
        .expect("first fetch");
    let other = ops::fetch_in_bulk(&state, &ids[1])
        .await
        .expect("second fetch");

    assert!(first.result.ok, "{:?}", first.result);
    assert!(other.result.ok, "{:?}", other.result);
    assert_eq!(snapshot_of(&first).id, ids[0]);
    assert_eq!(snapshot_of(&other).id, ids[1]);
}

/// プッシュダイアログに出すもの。**スナップショットには載せない**
#[tokio::test]
async fn reads_what_the_push_dialog_shows() {
    let fixture = Fixture::new().await;
    let other = fixture.other_clone("other").await;
    fixture.commit_in(&other, "theirs.txt", "theirs").await;
    fixture.git(&other, &["push", "origin", "main"]).await;
    fixture.commit("ours.txt").await;
    fixture.work_git(&["fetch"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let preview = ops::read_push_preview(&state, &ids[0], "main")
        .await
        .expect("preview should read");

    assert_eq!(preview.branch, "main");
    assert_eq!(preview.remote, "origin");
    assert_eq!(preview.upstream.as_deref(), Some("origin/main"));
    assert_eq!(preview.ahead.len(), 1);
    assert_eq!(preview.ahead[0].subject, "ours.txt");
    // 強制プッシュで失われる側も出す
    assert_eq!(preview.behind.len(), 1);
    assert_eq!(preview.behind[0].subject, "theirs.txt: theirs");
    let sha = preview.remote_sha.expect("the upstream sha is known");
    assert_eq!(sha.len(), 40, "{sha}");
}

/// 追跡ブランチが無いときは、リースの基準になる sha も無い
#[tokio::test]
async fn has_no_lease_without_an_upstream() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "fresh"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let preview = ops::read_push_preview(&state, &ids[0], "fresh")
        .await
        .expect("preview should read");

    assert_eq!(preview.upstream, None);
    assert_eq!(preview.remote_sha, None);
    assert_eq!(preview.remote, "origin");
    assert!(preview.ahead.is_empty());
}

/// **一括フェッチ中でもチェックアウトが待たされない。**
///
/// ネットワークの枠を待つあいだリポジトリのロックを持っていると、同じ
/// リポジトリのチェックアウトが枠が空くまで動けない
/// (docs/plans/phase-2-write.md の完了条件)。
#[tokio::test]
async fn does_not_hold_the_repository_lock_while_waiting_for_a_network_slot() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["branch", "topic"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;
    let id = ids[0].clone();
    // ネットワークの枠を全部押さえる。フェッチは枠待ちで止まる
    let mut held = Vec::new();
    for _ in 0..NETWORK_LIMIT {
        held.push(state.queue().network_permit().await);
    }

    let mut fetching = Box::pin(ops::run(&state, &id, &Operation::Fetch));
    // 1 回ポーリングして枠待ちに入らせる
    tokio::select! {
        _ = &mut fetching => panic!("枠が無いのにフェッチが走った"),
        () = tokio::task::yield_now() => {}
    }

    let to_topic = Operation::Checkout {
        name: "topic".to_owned(),
    };
    let outcome = tokio::time::timeout(Duration::from_secs(5), ops::run(&state, &id, &to_topic))
        .await
        .expect("枠待ちのフェッチにチェックアウトが待たされている")
        .expect("checkout");

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(snapshot_of(&outcome).head.name, "topic");

    // 枠を返せばフェッチも走る
    drop(held);
    let fetched = fetching.await.expect("fetch");
    assert!(fetched.result.ok, "{:?}", fetched.result);
}

/// 知らない id では git を実行しない
#[tokio::test]
async fn refuses_an_unknown_repository_id() {
    let fixture = Fixture::new().await;
    let (state, _) = fixture.state(&[fixture.work()]).await;

    let error = ops::run(&state, "r404", &Operation::Fetch)
        .await
        .expect_err("unknown id should fail");

    assert_eq!(error.to_string(), "知らないリポジトリの id です (r404)");
}

/// **追跡先が `gone` でもプッシュダイアログが開ける。**
///
/// 設定は残るので `%(upstream:...)` は名前を返すが、ref が無いので
/// `git log <上流>..<名前>` は exit 128 になる。ここで `Err` にすると
/// ダイアログが開いた直後に閉じて、`gone` の唯一の復旧手段が塞がる
#[tokio::test]
async fn reads_the_push_preview_of_a_gone_upstream() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "topic"]).await;
    fixture.work_git(&["push", "-u", "origin", "topic"]).await;
    // リモート側のブランチが消えた
    fixture
        .git(fixture.origin(), &["branch", "-D", "topic"])
        .await;
    fixture.work_git(&["fetch", "--prune"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let preview = ops::read_push_preview(&state, &ids[0], "topic")
        .await
        .expect("gone でも読める");

    assert_eq!(preview.upstream.as_deref(), Some("origin/topic"));
    assert_eq!(preview.remote_sha, None, "比べる相手が無い");
    assert!(preview.ahead.is_empty());
    assert!(preview.behind.is_empty());
}

/// `gone` のブランチはプッシュできる。プルは無効なので唯一の復旧手段
#[tokio::test]
async fn pushes_a_branch_whose_upstream_is_gone() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "topic"]).await;
    fixture.work_git(&["push", "-u", "origin", "topic"]).await;
    fixture
        .git(fixture.origin(), &["branch", "-D", "topic"])
        .await;
    fixture.work_git(&["fetch", "--prune"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Push {
            branch: "topic".to_owned(),
            force_with_lease: None,
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    let branches = fixture.git(fixture.origin(), &["branch"]).await;
    assert!(branches.contains("topic"), "{branches}");
}

/// **`check-ref-format` が弾く名前も止まる。**
///
/// 前段の部分文字列チェック (空・`-` 始まり・`@{`・`..`) だけを縛っていると、
/// git を呼ぶ検証が丸ごと無くなっても気づけない
#[tokio::test]
async fn refuses_names_only_git_can_judge() {
    let fixture = Fixture::new().await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    for name in [
        "main branch", // 空白
        "a~1",         // チルダ
        "x^",          // キャレット
        "has:colon",
        "trailing.lock",
        "double//slash",
        "back\\slash",
        "question?",
        "star*",
        "open[bracket",
    ] {
        let error = ops::run(
            &state,
            &ids[0],
            &Operation::Checkout {
                name: name.to_owned(),
            },
        )
        .await
        .expect_err(&format!("{name:?} は check-ref-format が弾く"));

        assert_eq!(
            error.to_string(),
            format!("参照名として使えません ({name})"),
            "{name:?}"
        );
    }
}

/// フェッチは `--prune` を付ける。付けないと `gone` を検出できない
#[tokio::test]
async fn prunes_when_fetching() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "topic"]).await;
    fixture.work_git(&["push", "-u", "origin", "topic"]).await;
    fixture.work_git(&["switch", "main"]).await;
    // リモート側のブランチが消えた
    fixture
        .git(fixture.origin(), &["branch", "-D", "topic"])
        .await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(&state, &ids[0], Operation::Fetch).await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(outcome.result.steps[0].command, "git fetch --prune");
    // `--prune` が無いと消えた追跡 ref が残り、`gone` が立たない
    let topic = snapshot_of(&outcome)
        .local
        .iter()
        .find(|branch| branch.name == "topic")
        .expect("topic is in the snapshot");
    assert!(topic.upstream_gone, "追跡先が消えたことを検出できていない");
    assert!(
        !snapshot_of(&outcome)
            .remote
            .iter()
            .any(|reference| reference.name == "origin/topic"),
        "消えた追跡 ref が残っている"
    );
}

/// **完全一致するローカルが先。** `origin/x` という名前のローカルブランチも作れる
#[tokio::test]
async fn prefers_a_local_branch_whose_name_looks_remote() {
    let fixture = Fixture::new().await;
    // ローカルに `origin/quirk` という名前のブランチを作る
    fixture.work_git(&["branch", "origin/quirk", "main"]).await;
    // リモートにも quirk がある
    let other = fixture.other_clone("other").await;
    fixture.git(&other, &["switch", "-c", "quirk"]).await;
    fixture.commit_in(&other, "remote.txt", "remote").await;
    fixture
        .git(&other, &["push", "-u", "origin", "quirk"])
        .await;
    fixture.work_git(&["fetch"]).await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Checkout {
            name: "origin/quirk".to_owned(),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(
        snapshot_of(&outcome).head.name,
        "origin/quirk",
        "同名のローカルを優先する。リモートとして解釈すると quirk に切り替わる"
    );
    assert_eq!(
        outcome.result.steps[0].command,
        "git switch --end-of-options origin/quirk"
    );
}

/// **読み取りは書き込みロックを待つ。**
///
/// 待たないと、フェッチが refs を書き換えている途中で `for-each-ref` を読んで、
/// 「フェッチしたのに ↙ が出ない」になる (docs/adr/0009-concurrency-and-refresh.md)
#[tokio::test]
async fn makes_a_read_wait_for_a_write() {
    let fixture = Fixture::new().await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;
    let id = ids[0].clone();
    let common = fixture
        .git(fixture.work(), &["rev-parse", "--git-common-dir"])
        .await;
    let common = std::fs::canonicalize(fixture.work().join(common.trim())).expect("common dir");

    let held = state.queue().write_lock(&common).await;
    let reading =
        tokio::time::timeout(Duration::from_millis(300), ops::read_snapshot(&state, &id)).await;
    assert!(reading.is_err(), "書き込み中の読み取りが素通りしている");

    drop(held);
    tokio::time::timeout(Duration::from_secs(5), ops::read_snapshot(&state, &id))
        .await
        .expect("ロックが空いたら読める")
        .expect("snapshot");
}

/// 読み取りの同時実行は 4 まで。5 本目は枠が空くまで待つ
#[tokio::test]
async fn limits_how_many_snapshots_are_read_at_once() {
    let fixture = Fixture::new().await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;
    let mut permits = Vec::new();
    for _ in 0..READ_LIMIT {
        permits.push(state.queue().read_permit().await);
    }

    let reading = tokio::time::timeout(
        Duration::from_millis(300),
        ops::read_snapshot(&state, &ids[0]),
    )
    .await;

    assert!(reading.is_err(), "読み取りの枠を通っていない");
    drop(permits);
}

/// **上流の名前が違うブランチでも、push 先とリースの参照名が一致する。**
///
/// `git push origin dev` は `refs/heads/dev` を更新するので、リースを
/// 上流の名前 (`main`) に付けると、更新する ref に何も掛からない
#[tokio::test]
async fn pushes_to_the_upstream_branch_when_the_names_differ() {
    let fixture = Fixture::new().await;
    // ローカル `dev` の上流を `origin/main` にする
    fixture.work_git(&["switch", "-c", "dev"]).await;
    fixture
        .work_git(&["branch", "--set-upstream-to=origin/main", "dev"])
        .await;
    fixture.commit("ours.txt").await;
    let seen = fixture
        .work_git(&["rev-parse", "refs/remotes/origin/main"])
        .await
        .trim()
        .to_owned();
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Push {
            branch: "dev".to_owned(),
            force_with_lease: Some(seen.clone()),
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    let command = &outcome.result.steps[0].command;
    assert!(
        command.contains(&format!("--force-with-lease=main:{seen}")),
        "{command}"
    );
    assert!(
        command.contains("origin dev:main"),
        "push 先が省かれている: {command}"
    );
    // 更新されたのは origin/main。dev という ref は作られない
    let branches = fixture.git(fixture.origin(), &["branch"]).await;
    assert!(branches.contains("main"), "{branches}");
    assert!(
        !branches.contains("dev"),
        "意図しない ref ができている: {branches}"
    );
}

/// 追跡先の名前が同じときも push 先を明示する
#[tokio::test]
async fn names_the_push_target_even_when_it_matches() {
    let fixture = Fixture::new().await;
    fixture.commit("ours.txt").await;
    let (state, ids) = fixture.state(&[fixture.work()]).await;

    let outcome = run(
        &state,
        &ids[0],
        Operation::Push {
            branch: "main".to_owned(),
            force_with_lease: None,
        },
    )
    .await;

    assert!(outcome.result.ok, "{:?}", outcome.result);
    assert_eq!(
        outcome.result.steps[0].command,
        "git push --end-of-options origin main:main"
    );
}
