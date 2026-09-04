import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event");

import { listen } from "@tauri-apps/api/event";

import { EVENTS } from "./commands";
import { onRepoSnapshotUpdated, onReposChanged } from "./events";

/*
 * 購読するチャンネル。
 *
 * **どの名前で待つかを見る。** `commands.test.ts` は「その名前を Rust が
 * emit している」ことしか見ていないので、ここでラッパが取り違えても通る
 * (docs/testing.md の「配線を見ていない呼び出し」)。
 */

/** `listen` に渡されたチャンネル名と、届いたペイロードを流すハンドラ */
function subscribed(): { name: string; deliver: (payload: unknown) => void } {
  const call = vi.mocked(listen).mock.calls.at(-1);
  if (call === undefined) throw new Error("listen を呼んでいない");
  const [name, handle] = call;
  return {
    name,
    deliver: (payload) => {
      // Tauri は `{ event, id, payload }` の形で渡す
      handle({ event: name, id: 1, payload });
    },
  };
}

describe("イベントの購読", () => {
  it("`.git` の変化は repos_changed で待つ", () => {
    const received: string[][] = [];
    void onReposChanged((repoIds) => received.push(repoIds));

    const { name, deliver } = subscribed();
    deliver(["r1", "r2"]);

    expect(name).toBe(EVENTS.reposChanged);
    expect(received).toEqual([["r1", "r2"]]);
  });

  it("一括フェッチの結果は repo_snapshot_updated で待つ", () => {
    void onRepoSnapshotUpdated(() => undefined);

    expect(subscribed().name).toBe(EVENTS.repoSnapshotUpdated);
  });

  /** 2 つが同じチャンネルを見ていたら、片方の結果でもう片方が動く */
  it("2 つは別のチャンネル", () => {
    expect(EVENTS.reposChanged).not.toBe(EVENTS.repoSnapshotUpdated);
  });
});
