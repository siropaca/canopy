//! 実物の git で `RepoSnapshot` を組み立てる。
//!
//! 投資の重心はここ。このアプリはロジックより「git の実物と噛み合うか」が
//! 壊れやすい (docs/testing.md)。

mod support;

use canopy_lib::model::HeadKind;
use support::Fixture;

/// クローンした直後の状態を読める
#[tokio::test]
async fn reads_a_fresh_clone() {
    let fixture = Fixture::new().await;

    let snapshot = fixture.snapshot().await;

    assert_eq!(snapshot.head.kind, HeadKind::Branch);
    assert_eq!(snapshot.head.name, "main");
    assert_eq!(snapshot.local.len(), 1);
    let main = &snapshot.local[0];
    assert_eq!(main.name, "main");
    assert!(main.is_current);
    assert_eq!(main.upstream, Some("origin/main".to_owned()));
    assert!(!main.upstream_gone);
    assert_eq!((main.behind, main.ahead), (0, 0));
    assert!(main.committed_at > 0);
    assert_eq!(main.worktree_path, None);
    assert_eq!(snapshot.changes.total, 0);
    assert!(snapshot.worktrees.is_empty());
    assert!(snapshot.tags.is_empty());
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.name, "work");
}

/// `refs/remotes` から、リモート名そのものになる `origin/HEAD` を除く
/// (docs/pitfalls.md)
#[tokio::test]
async fn does_not_list_the_remote_name_as_a_branch() {
    let fixture = Fixture::new().await;
    // clone は origin/HEAD を作る。実際に混ざる状態で確かめる
    fixture
        .work_git(&["remote", "set-head", "origin", "main"])
        .await;

    let snapshot = fixture.snapshot().await;

    let names: Vec<&str> = snapshot.remote.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["origin/main"]);
}

/// origin 以外のリモートのブランチも並ぶ (fork がある構成)
#[tokio::test]
async fn reads_branches_of_a_second_remote() {
    let fixture = Fixture::new().await;
    let upstream = fixture.root().join("upstream.git");
    fixture
        .git(
            fixture.root(),
            &["init", "--bare", "-b", "main", "upstream.git"],
        )
        .await;
    fixture
        .work_git(&[
            "remote",
            "add",
            "upstream",
            upstream.to_str().expect("path"),
        ])
        .await;
    fixture.work_git(&["push", "upstream", "main"]).await;
    fixture.work_git(&["fetch", "upstream"]).await;

    let snapshot = fixture.snapshot().await;

    let names: Vec<&str> = snapshot.remote.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["origin/main", "upstream/main"]);
}

/// behind と ahead を数える
#[tokio::test]
async fn counts_behind_and_ahead() {
    let fixture = Fixture::new().await;
    fixture.commit("second").await;
    fixture.commit("third").await;
    fixture.work_git(&["push", "origin", "main"]).await;
    // origin より 2 コミット戻す -> behind 2
    fixture.work_git(&["reset", "--hard", "HEAD~2"]).await;
    // 別のブランチで 1 コミット積む -> ahead 1
    fixture.work_git(&["switch", "-c", "feature/x"]).await;
    fixture
        .work_git(&["push", "-u", "origin", "feature/x"])
        .await;
    fixture.commit("fourth").await;

    let snapshot = fixture.snapshot().await;

    let main = snapshot
        .local
        .iter()
        .find(|branch| branch.name == "main")
        .expect("main exists");
    let feature = snapshot
        .local
        .iter()
        .find(|branch| branch.name == "feature/x")
        .expect("feature/x exists");
    assert_eq!((main.behind, main.ahead), (2, 0));
    assert_eq!((feature.behind, feature.ahead), (0, 1));
    assert!(feature.is_current);
    assert!(!main.is_current);
}

/// 未コミットの変更を数える。日本語のパスがエスケープされない
/// (`core.quotepath=false` が効いていること)
#[tokio::test]
async fn reads_uncommitted_changes() {
    let fixture = Fixture::new().await;
    fixture.write("first", "changed");
    fixture.write("新しい 資料.md", "日本語のパス");

    let snapshot = fixture.snapshot().await;

    let paths: Vec<&str> = snapshot
        .changes
        .items
        .iter()
        .map(|change| change.path.as_str())
        .collect();
    assert_eq!(paths, vec!["first", "新しい 資料.md"]);
    assert_eq!(snapshot.changes.total, 2);
    assert_eq!(snapshot.changes.items[0].status, "M");
    assert_eq!(snapshot.changes.items[1].status, "??");
}

/// **未追跡のディレクトリは git が 1 件に畳む。**
/// 中の 3 ファイルではなくディレクトリ 1 件として返る。
/// `-uall` で開くと `.gitignore` を整える前のリポジトリで数千行になるので、
/// git の既定のまま扱う (docs/specs/data-model.md)
#[tokio::test]
async fn collapses_an_untracked_directory_into_one_entry() {
    let fixture = Fixture::new().await;
    fixture.write("docs/a.md", "a");
    fixture.write("docs/b.md", "b");
    fixture.write("docs/c.md", "c");

    let snapshot = fixture.snapshot().await;

    assert_eq!(snapshot.changes.total, 1);
    assert_eq!(snapshot.changes.items[0].path, "docs/");
}

/// 追跡先が消えたブランチを `gone` として持つ。
/// 未設定 (`upstream` が null) とは別の状態 (docs/specs/data-model.md)
#[tokio::test]
async fn reads_a_gone_upstream() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["switch", "-c", "dev/old"]).await;
    fixture.work_git(&["push", "-u", "origin", "dev/old"]).await;
    fixture
        .work_git(&["push", "origin", "--delete", "dev/old"])
        .await;
    fixture.work_git(&["fetch", "--prune"]).await;
    fixture.work_git(&["switch", "-c", "local-only"]).await;

    let snapshot = fixture.snapshot().await;

    let gone = snapshot
        .local
        .iter()
        .find(|branch| branch.name == "dev/old")
        .expect("dev/old exists");
    assert!(gone.upstream_gone);
    assert_eq!(gone.upstream, Some("origin/dev/old".to_owned()));

    let never_pushed = snapshot
        .local
        .iter()
        .find(|branch| branch.name == "local-only")
        .expect("local-only exists");
    assert!(!never_pushed.upstream_gone);
    assert_eq!(never_pushed.upstream, None);
}

/// ワークツリーを、そのワークツリーの未コミットと一緒に読む。
/// リポジトリ単位にまとめない (docs/specs/data-model.md)
#[tokio::test]
async fn reads_worktrees_with_their_own_changes() {
    let fixture = Fixture::new().await;
    let worktree = fixture.root().join("wt");
    fixture.work_git(&["switch", "-c", "dev/side"]).await;
    fixture.work_git(&["switch", "main"]).await;
    fixture
        .work_git(&[
            "worktree",
            "add",
            worktree.to_str().expect("path"),
            "dev/side",
        ])
        .await;
    fixture.write_in(&worktree, "only-here.txt", "side work");
    fixture.write("main-side.txt", "main work");

    let snapshot = fixture.snapshot().await;

    assert_eq!(snapshot.worktrees.len(), 1);
    let listed = &snapshot.worktrees[0];
    assert_eq!(listed.branch, "dev/side");
    assert_eq!(listed.changes.total, 1);
    assert_eq!(listed.changes.items[0].path, "only-here.txt");
    // メインの未コミットは混ざらない
    assert_eq!(snapshot.changes.total, 1);
    assert_eq!(snapshot.changes.items[0].path, "main-side.txt");
    // ブランチ行に ⧉ を出すためのパスが入る
    let side = snapshot
        .local
        .iter()
        .find(|branch| branch.name == "dev/side")
        .expect("dev/side exists");
    assert_eq!(side.worktree_path.as_deref(), listed.path.as_str().into());
}

/// 消えたワークツリー (prunable) では git を実行しない。
/// 実行すると失敗してスナップショット全体が落ちる
#[tokio::test]
async fn skips_a_prunable_worktree() {
    let fixture = Fixture::new().await;
    let worktree = fixture.root().join("wt-gone");
    fixture.work_git(&["switch", "-c", "dev/side"]).await;
    fixture.work_git(&["switch", "main"]).await;
    fixture
        .work_git(&[
            "worktree",
            "add",
            worktree.to_str().expect("path"),
            "dev/side",
        ])
        .await;
    std::fs::remove_dir_all(&worktree).expect("remove the worktree directory");

    let snapshot = fixture.snapshot().await;

    assert!(snapshot.worktrees.is_empty());
}

/// タグを読む。**annotated タグも日時を持つ**
/// (`committerdate` は空になるので `creatordate` を使っている)
#[tokio::test]
async fn reads_lightweight_and_annotated_tags() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["tag", "light"]).await;
    fixture
        .work_git(&["tag", "-a", "annotated", "-m", "release"])
        .await;

    let snapshot = fixture.snapshot().await;

    let names: Vec<&str> = snapshot.tags.iter().map(|tag| tag.name.as_str()).collect();
    assert_eq!(names, vec!["annotated", "light"]);
    for tag in &snapshot.tags {
        assert!(tag.committed_at > 0, "{} の日時が空", tag.name);
    }
}

/// detached HEAD でも表示が崩れない。タグ名を持たせる
/// (docs/specs/ui.md の「detached HEAD」)
#[tokio::test]
async fn reads_a_detached_head_at_a_tag() {
    let fixture = Fixture::new().await;
    fixture
        .work_git(&["tag", "-a", "v1.0.0", "-m", "release"])
        .await;
    fixture
        .work_git(&["checkout", "--detach", "refs/tags/v1.0.0"])
        .await;

    let snapshot = fixture.snapshot().await;

    assert_eq!(snapshot.head.kind, HeadKind::Detached);
    assert_eq!(snapshot.head.name, "v1.0.0");
    // 現在ブランチはどれでもない
    assert!(snapshot.local.iter().all(|branch| !branch.is_current));
}

/// タグを指していない detached HEAD は短縮ハッシュを出す
#[tokio::test]
async fn reads_a_detached_head_without_a_tag() {
    let fixture = Fixture::new().await;
    fixture.commit("second").await;
    fixture.work_git(&["checkout", "--detach", "HEAD~1"]).await;

    let snapshot = fixture.snapshot().await;

    assert_eq!(snapshot.head.kind, HeadKind::Detached);
    assert!(
        snapshot.head.name.len() >= 7 && snapshot.head.name.chars().all(|c| c.is_ascii_hexdigit()),
        "短縮ハッシュではない: {}",
        snapshot.head.name
    );
}

/// origin の URL を https の形に直す
#[tokio::test]
async fn normalizes_the_origin_url() {
    let fixture = Fixture::new().await;
    fixture
        .work_git(&[
            "remote",
            "set-url",
            "origin",
            "git@github.com:acme/acme-api.git",
        ])
        .await;

    let snapshot = fixture.snapshot().await;

    assert_eq!(
        snapshot.origin_url,
        Some("https://github.com/acme/acme-api".to_owned())
    );
}

/// origin が無いリポジトリでも読める
#[tokio::test]
async fn reads_a_repository_without_a_remote() {
    let fixture = Fixture::new().await;
    let alone = fixture.root().join("alone");
    std::fs::create_dir_all(&alone).expect("create dir");
    fixture.git(&alone, &["init", "-b", "main"]).await;
    fixture
        .git(&alone, &["config", "user.email", "t@example.com"])
        .await;
    fixture.git(&alone, &["config", "user.name", "Test"]).await;
    fixture.write_in(&alone, "a.txt", "a");
    fixture.git(&alone, &["add", "a.txt"]).await;
    fixture.git(&alone, &["commit", "-m", "first"]).await;

    let snapshot = fixture.snapshot_of(&alone, 1).await;

    assert_eq!(snapshot.origin_url, None);
    assert!(snapshot.remote.is_empty());
    assert_eq!(snapshot.local.len(), 1);
    assert_eq!(snapshot.local[0].upstream, None);
}

/// ワークツリーを別のリポジトリとして登録できない。
/// 別々に登録すると同じ refs を同時に更新して片方が落ちる (docs/pitfalls.md)
#[tokio::test]
async fn rejects_registering_a_worktree_as_another_repository() {
    let fixture = Fixture::new().await;
    let worktree = fixture.root().join("wt");
    fixture
        .work_git(&[
            "worktree",
            "add",
            "-b",
            "dev/side",
            worktree.to_str().expect("path"),
        ])
        .await;
    let (mut registry, _) = fixture.register(fixture.work()).await;

    let result = fixture.add_to(&mut registry, &worktree).await;

    assert!(
        result.is_err(),
        "ワークツリーが別リポジトリとして登録された"
    );
    assert_eq!(registry.registrations().len(), 1);
}

/// 世代は呼び出しごとに渡した値がそのまま入る
#[tokio::test]
async fn carries_the_revision() {
    let fixture = Fixture::new().await;

    let snapshot = fixture.snapshot_of(fixture.work(), 7).await;

    assert_eq!(snapshot.revision, 7);
}

/// ディレクトリが消えていたら、そのリポジトリだけがエラーになる
#[tokio::test]
async fn reports_a_missing_directory() {
    let fixture = Fixture::new().await;
    let (registry, id) = fixture.register(fixture.work()).await;
    let repo = registry.resolve(&id).expect("resolves");
    let common_dir = registry.common_dir_of(&id).expect("known");
    std::fs::remove_dir_all(fixture.work()).expect("remove the working copy");

    let error = canopy_lib::git::build_snapshot(&id, "work", &repo, &common_dir, 1)
        .await
        .expect_err("should fail");

    assert_eq!(error.to_string(), "ディレクトリが見つかりません");
}

/// **同名のブランチとタグがあっても名前が壊れない。**
/// `refname:short` は `heads/v1.0` を返すので `refname:lstrip=2` を使っている (実測)
#[tokio::test]
async fn reads_a_branch_and_a_tag_with_the_same_name() {
    let fixture = Fixture::new().await;
    let worktree = fixture.root().join("wt");
    fixture.work_git(&["branch", "v1.0"]).await;
    fixture.work_git(&["tag", "v1.0"]).await;
    // 同名のブランチを別のワークツリーに出して、⧉ の紐づけまで見る
    fixture
        .work_git(&["worktree", "add", worktree.to_str().expect("path"), "v1.0"])
        .await;

    let snapshot = fixture.snapshot().await;

    let names: Vec<&str> = snapshot.local.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, vec!["main", "v1.0"]);
    assert_eq!(
        snapshot
            .tags
            .iter()
            .map(|t| t.name.as_str())
            .collect::<Vec<_>>(),
        vec!["v1.0"]
    );
    // 名前が一致するのでワークツリーに紐づく
    let branch = snapshot
        .local
        .iter()
        .find(|b| b.name == "v1.0")
        .expect("v1.0 exists");
    assert!(branch.worktree_path.is_some(), "⧉ の紐づけが切れている");
}

/// **commit を指さないタグでスナップショット全体が落ちない。**
/// tree を指す軽量タグは日時を持たないので、載せずに落とす (実測)
#[tokio::test]
async fn ignores_tags_that_do_not_point_at_a_commit() {
    let fixture = Fixture::new().await;
    let tree = fixture.work_git(&["rev-parse", "HEAD^{tree}"]).await;
    fixture.work_git(&["tag", "tree-tag", tree.trim()]).await;
    fixture.work_git(&["tag", "v1.0.0"]).await;

    let snapshot = fixture.snapshot().await;

    assert_eq!(
        snapshot
            .tags
            .iter()
            .map(|t| t.name.as_str())
            .collect::<Vec<_>>(),
        vec!["v1.0.0"]
    );
    // ブランチも読めている (全体が Err になっていない)
    assert_eq!(snapshot.local.len(), 1);
}

/// 最後に fetch した時刻を `FETCH_HEAD` の mtime から読む
#[tokio::test]
async fn reads_the_last_fetch_time() {
    let fixture = Fixture::new().await;
    fixture.work_git(&["fetch", "origin"]).await;

    let snapshot = fixture.snapshot().await;

    let fetched_at = snapshot.fetched_at.expect("fetch した時刻がある");
    assert!(fetched_at > 1_700_000_000_000, "{fetched_at} が古すぎる");
}

/// git の失敗を握りつぶさない。空の出力をパースして「0 件」にしない
#[tokio::test]
async fn fails_when_git_exits_non_zero() {
    let fixture = Fixture::new().await;
    let (registry, id) = fixture.register(fixture.work()).await;
    let repo = registry.resolve(&id).expect("resolves");

    let error = canopy_lib::git::run_ok(&repo, &["rev-parse", "--verify", "refs/heads/nope"])
        .await
        .expect_err("知らない参照は失敗する");

    assert!(error.to_string().contains("失敗しました"), "{error}");
}

/// bare リポジトリは登録できない。読み取りが必ず失敗するので入口で弾く
#[tokio::test]
async fn refuses_a_bare_repository() {
    let fixture = Fixture::new().await;
    let candidate = canopy_lib::store::RepoPath::from_picked_folder(fixture.origin().to_owned());

    let error = canopy_lib::git::toplevel(&candidate)
        .await
        .expect_err("bare は弾く");

    assert_eq!(
        error.to_string(),
        "作業コピーがありません (bare リポジトリと .git は登録できません)"
    );
}

/// リポジトリのサブディレクトリを選んでも、登録するのは最上位。
/// サブディレクトリを登録すると、メインのワークツリーが二重に出る
#[tokio::test]
async fn resolves_a_subdirectory_to_the_top_level() {
    let fixture = Fixture::new().await;
    let inside = fixture.work().join("docs");
    std::fs::create_dir_all(&inside).expect("create dir");
    let candidate = canopy_lib::store::RepoPath::from_picked_folder(inside);

    let top = canopy_lib::git::toplevel(&candidate)
        .await
        .expect("最上位が取れる");

    assert_eq!(
        std::fs::canonicalize(&top).expect("canonicalize"),
        std::fs::canonicalize(fixture.work()).expect("canonicalize")
    );
}

/// git リポジトリではないフォルダは、その理由を返す
#[tokio::test]
async fn reports_a_folder_that_is_not_a_repository() {
    let fixture = Fixture::new().await;
    let plain = fixture.root().join("plain");
    std::fs::create_dir_all(&plain).expect("create dir");
    let candidate = canopy_lib::store::RepoPath::from_picked_folder(plain);

    let error = canopy_lib::git::common_dir(&candidate)
        .await
        .expect_err("should fail");

    assert_eq!(error.to_string(), "git リポジトリではありません");
}
