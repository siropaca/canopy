import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AddRepoOutcome } from "@/ipc/generated/AddRepoOutcome";
import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { UiState } from "@/ipc/generated/UiState";
import { makeBranch, makeSnapshot } from "@/test/factories";

vi.mock("@/ipc/repos");

import * as ipc from "@/ipc/repos";

import {
  addRepository,
  loadEverything,
  loadSnapshot,
  removeRepository,
  resetRequests,
} from "./bootstrap";
import { useConsoleStore } from "./useConsoleStore";
import { orderedRepos, useRepoStore } from "./useRepoStore";
import { useUiStore } from "./useUiStore";

const DEFAULT_UI: UiState = {
  repo_order: [],
  expanded: [],
  pane_width: 360,
  console_open: false,
  window: null,
  group_directories: true,
  local_only: false,
};

function registration(id: string, name: string): RepoRegistration {
  return { id, name, path: `/repos/${name}` };
}

/** ストアはシングルトンなので、テストごとに初期状態へ戻す */
function resetStores(): void {
  resetRequests();
  useRepoStore.setState({ byId: new Map(), order: [], loaded: false, loadError: null });
  useUiStore.getState().setExpanded([]);
  useUiStore.getState().select(null);
}

describe("起動時の読み込み", () => {
  beforeEach(() => {
    vi.mocked(ipc).listRepos.mockReset();
    vi.mocked(ipc).getUiState.mockReset();
    vi.mocked(ipc).getRepoSnapshot.mockReset();
    vi.mocked(ipc).addRepo.mockReset();
    vi.mocked(ipc).removeRepo.mockReset();
    resetStores();
  });

  it("見出しを全件描いてから、届いた分を埋める", async () => {
    vi.mocked(ipc).listRepos.mockResolvedValue([
      registration("r1", "acme-api"),
      registration("r2", "acme-web"),
    ]);
    vi.mocked(ipc).getUiState.mockResolvedValue(DEFAULT_UI);
    vi.mocked(ipc).getRepoSnapshot.mockImplementation((repoId) =>
      Promise.resolve(makeSnapshot({ id: repoId })),
    );

    await loadEverything();

    expect(orderedRepos(useRepoStore.getState()).map((repo) => repo.status)).toEqual([
      "ready",
      "ready",
    ]);
  });

  it("1 件の失敗で全体を落とさない (docs/specs/data-model.md)", async () => {
    vi.mocked(ipc).listRepos.mockResolvedValue([
      registration("r1", "acme-api"),
      registration("r2", "broken"),
    ]);
    vi.mocked(ipc).getUiState.mockResolvedValue(DEFAULT_UI);
    vi.mocked(ipc).getRepoSnapshot.mockImplementation((repoId): Promise<RepoSnapshot> => {
      // Tauri は Err を文字列 1 本にして reject する。実物と同じ形で試す
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- IPC の実際の形
      if (repoId === "r2") return Promise.reject("ディレクトリが見つかりません");
      return Promise.resolve(makeSnapshot({ id: repoId }));
    });

    await loadEverything();

    const repos = orderedRepos(useRepoStore.getState());
    expect(repos.map((repo) => repo.status)).toEqual(["ready", "error"]);
    expect(repos[1]?.error).toBe("ディレクトリが見つかりません");
  });

  it("保存してあった UI 状態を反映する", async () => {
    vi.mocked(ipc).listRepos.mockResolvedValue([registration("r1", "acme-api")]);
    vi.mocked(ipc).getUiState.mockResolvedValue({
      ...DEFAULT_UI,
      expanded: ["r1|repo|"],
      pane_width: 500,
    });
    vi.mocked(ipc).getRepoSnapshot.mockResolvedValue(makeSnapshot({ id: "r1" }));

    await loadEverything();

    expect([...useUiStore.getState().expanded]).toEqual(["r1|repo|"]);
    expect(useUiStore.getState().paneWidth).toBe(500);
  });

  it("設定が読めなければ理由を残す。握りつぶさない", async () => {
    vi.mocked(ipc).listRepos.mockRejectedValue("設定の中身が壊れています");
    vi.mocked(ipc).getUiState.mockRejectedValue("設定の中身が壊れています");

    await loadEverything();

    expect(useRepoStore.getState().loadError).toBe("設定の中身が壊れています");
    expect(vi.mocked(ipc).getRepoSnapshot).not.toHaveBeenCalled();
  });
});

describe("リポジトリの追加", () => {
  beforeEach(() => {
    vi.mocked(ipc).addRepo.mockReset();
    vi.mocked(ipc).getRepoSnapshot.mockReset();
    vi.mocked(ipc).removeRepo.mockReset();
    resetStores();
  });

  it("登録した直後だけ既定の展開を当てる", async () => {
    vi.mocked(ipc).addRepo.mockResolvedValue({
      kind: "added",
      repo: registration("r1", "acme-api"),
    } satisfies AddRepoOutcome);
    vi.mocked(ipc).getRepoSnapshot.mockResolvedValue(
      makeSnapshot({ id: "r1", local: [makeBranch("feature/rec-482"), makeBranch("main")] }),
    );

    await addRepository();

    expect(useRepoStore.getState().byId.get("r1")?.status).toBe("ready");
    expect([...useUiStore.getState().expanded].sort()).toEqual([
      "r1|local|",
      "r1|local|feature",
      "r1|repo|",
    ]);
  });

  it("キャンセルなら何も足さない", async () => {
    vi.mocked(ipc).addRepo.mockResolvedValue({ kind: "cancelled" } satisfies AddRepoOutcome);

    await addRepository();

    expect(useRepoStore.getState().order).toEqual([]);
    expect(vi.mocked(ipc).getRepoSnapshot).not.toHaveBeenCalled();
  });

  it("断られたときも何も足さない (理由は Rust 側が見せる)", async () => {
    vi.mocked(ipc).addRepo.mockResolvedValue({
      kind: "rejected",
      message: "このリポジトリは登録済みです (acme-api)",
    } satisfies AddRepoOutcome);

    await addRepository();

    expect(useRepoStore.getState().order).toEqual([]);
  });

  it("削除すると選択も外れる", async () => {
    vi.mocked(ipc).addRepo.mockResolvedValue({
      kind: "added",
      repo: registration("r1", "acme-api"),
    } satisfies AddRepoOutcome);
    vi.mocked(ipc).getRepoSnapshot.mockResolvedValue(makeSnapshot({ id: "r1" }));
    vi.mocked(ipc).removeRepo.mockResolvedValue(undefined);
    await addRepository();
    useUiStore.getState().select("r1|repo|");
    useConsoleStore
      .getState()
      .append("r1", [{ lines: [{ kind: "command", text: "git fetch --prune" }] }], {
        failed: false,
      });

    await removeRepository("r1");

    expect(useRepoStore.getState().order).toEqual([]);
    expect(useUiStore.getState().selectedKey).toBeNull();
    // タブを残すと、名前を引く先が無くなって生の id がタブに出る
    expect(useConsoleStore.getState().blocks.has("r1")).toBe(false);
  });
});

describe("読み直し", () => {
  beforeEach(() => {
    vi.mocked(ipc).getRepoSnapshot.mockReset();
    resetStores();
  });

  it("**古い失敗が新しいスナップショットを消さない。** 失敗には世代が付かない", async () => {
    useRepoStore.getState().registerAll([registration("r1", "acme-api")]);
    // 1 本目は遅れて失敗し、2 本目は先に成功する
    let failFirst: (reason: string) => void = () => undefined;
    vi.mocked(ipc)
      .getRepoSnapshot.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failFirst = reject;
          }),
      )
      .mockResolvedValueOnce(makeSnapshot({ id: "r1", revision: 2, name: "新しい" }));

    const first = loadSnapshot("r1");
    await loadSnapshot("r1");
    failFirst("ディレクトリが見つかりません");
    await first;

    expect(useRepoStore.getState().byId.get("r1")?.status).toBe("ready");
    expect(useRepoStore.getState().byId.get("r1")?.name).toBe("新しい");
  });

  it("最後の失敗は反映する", async () => {
    useRepoStore.getState().registerAll([registration("r1", "acme-api")]);
    vi.mocked(ipc).getRepoSnapshot.mockRejectedValue("ディレクトリが見つかりません");

    await loadSnapshot("r1");

    expect(useRepoStore.getState().byId.get("r1")?.status).toBe("error");
  });

  it("古い世代で上書きしない", async () => {
    useRepoStore.getState().registerAll([registration("r1", "acme-api")]);
    useRepoStore.getState().applySnapshot(makeSnapshot({ id: "r1", revision: 3 }));
    vi.mocked(ipc).getRepoSnapshot.mockResolvedValue(
      makeSnapshot({ id: "r1", revision: 2, name: "古い" }),
    );

    await loadSnapshot("r1");

    expect(useRepoStore.getState().byId.get("r1")?.name).toBe("acme-api");
  });
});
