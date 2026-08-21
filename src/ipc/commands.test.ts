import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COMMANDS, EVENTS } from "./commands";

const LIB_RS = fileURLToPath(new URL("../../src-tauri/src/lib.rs", import.meta.url));
/** コマンドを定義しているファイル。増やしたらここに足す (src-tauri/src/commands/mod.rs) */
const COMMAND_RS = ["settings", "snapshot", "ops"].map((name) =>
  fileURLToPath(new URL(`../../src-tauri/src/commands/${name}.rs`, import.meta.url)),
);
const OPS_RS = fileURLToPath(new URL("../../src-tauri/src/commands/ops.rs", import.meta.url));
/** invoke を呼んでいるラッパ */
const WRAPPERS_TS = ["repos", "ops"].map((name) =>
  fileURLToPath(new URL(`./${name}.ts`, import.meta.url)),
);

function read(paths: readonly string[]): string {
  return paths.map((path) => readFileSync(path, "utf8")).join("\n");
}

/** `invoke_handler()` に並んでいるコマンド名を読む */
export function readRegisteredCommands(source: string): string[] {
  const block = /tauri::generate_handler!\[([^\]]*)\]/.exec(source);
  if (!block?.[1]) {
    throw new Error("lib.rs に generate_handler! が無い");
  }
  return [...block[1].matchAll(/commands::\w+::(\w+)/g)].map(([, name]) => name ?? "");
}

/**
 * Rust のコマンドが受け取る引数名を読む。
 *
 * `state` と `app` は Tauri が差し込むので、フロントは送らない。
 */
export function readCommandArguments(source: string): Record<string, string[]> {
  const commands: Record<string, string[]> = {};
  for (const [, name, params] of source.matchAll(/pub async fn (\w+)(?:<[^>]*>)?\(([^)]*)\)/g)) {
    if (name === undefined || params === undefined) continue;
    commands[name] = splitParams(params)
      .map((param) => param.split(":")[0]?.trim() ?? "")
      .filter((param) => param !== "state" && param !== "app" && param !== "");
  }
  return commands;
}

/**
 * 引数を `,` で分ける。`<>` の中は区切りとして見ない。
 * `State<'_, AppState>` が 2 つに割れるのを防ぐ。
 */
export function splitParams(params: string): string[] {
  const found: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of params) {
    if (char === "<") depth += 1;
    else if (char === ">") depth -= 1;
    if (char === "," && depth === 0) {
      found.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  found.push(current.trim());
  return found.filter((param) => param !== "");
}

/** フロントが invoke に渡しているキーを読む */
export function readInvokedArguments(source: string): Record<string, string[]> {
  const calls: Record<string, string[]> = {};
  for (const [, command, body] of source.matchAll(
    /invoke<[^>]*>\(\s*COMMANDS\.(\w+)(?:,\s*\{([^}]*)\})?\s*\)/g,
  )) {
    if (command === undefined) continue;
    calls[command] = (body ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .map((entry) => entry.split(":")[0]?.trim() ?? entry);
  }
  return calls;
}

/** Rust 側が emit しているイベント名を読む */
export function readEventNames(source: string): string[] {
  return [...source.matchAll(/pub const \w+: &str = "(\w+)";/g)].map(([, name]) => name ?? "");
}

describe("コマンドの引数名", () => {
  it("invoke に渡すキーが Rust の引数名と一致する", () => {
    const declared = readCommandArguments(read(COMMAND_RS));
    const invoked = readInvokedArguments(read(WRAPPERS_TS));

    for (const [key, command] of Object.entries(COMMANDS)) {
      expect(invoked[key], `${key} を invoke している行が無い`).toBeDefined();
      expect([...(invoked[key] ?? [])].sort(), `${command} の引数名`).toEqual(
        [...(declared[command] ?? [])].sort(),
      );
    }
  });
});

describe("splitParams", () => {
  it("ジェネリクスの中の `,` で割らない", () => {
    expect(splitParams("state: State<'_, AppState>, repo_id: String")).toEqual([
      "state: State<'_, AppState>",
      "repo_id: String",
    ]);
  });
});

describe("readCommandArguments", () => {
  it("Tauri が差し込む引数は除く", () => {
    const source = `
      pub async fn get_repo_snapshot(
          state: State<'_, AppState>,
          repo_id: String,
      ) -> Result<RepoSnapshot, CommandError> {}
      pub async fn add_repo<R: Runtime>(
          app: AppHandle<R>,
          state: State<'_, AppState>,
      ) -> Result<AddRepoOutcome, CommandError> {}
    `;

    expect(readCommandArguments(source)).toEqual({
      get_repo_snapshot: ["repo_id"],
      add_repo: [],
    });
  });
});

describe("readInvokedArguments", () => {
  it("引数の無い invoke も拾う", () => {
    const source = `
      export function listRepos() { return invoke<RepoRegistration[]>(COMMANDS.listRepos); }
      export function removeRepo(repoId: RepoId) {
        return invoke<void>(COMMANDS.removeRepo, { repo_id: repoId });
      }
    `;

    expect(readInvokedArguments(source)).toEqual({
      listRepos: [],
      removeRepo: ["repo_id"],
    });
  });
});

describe("コマンドの名前", () => {
  it("フロントの一覧と Rust の登録が一致する", () => {
    const registered = readRegisteredCommands(readFileSync(LIB_RS, "utf8"));

    expect(registered.sort()).toEqual([...Object.values(COMMANDS)].sort());
  });

  it("キーは camelCase、値は snake_case", () => {
    for (const [key, value] of Object.entries(COMMANDS)) {
      expect(key).toMatch(/^[a-z][A-Za-z]*$/);
      expect(value).toMatch(/^[a-z][a-z_]*$/);
    }
  });
});

describe("イベントの名前", () => {
  it("購読する名前が Rust の emit する名前と一致する", () => {
    const emitted = readEventNames(readFileSync(OPS_RS, "utf8"));

    for (const name of Object.values(EVENTS)) {
      expect(emitted, `${name} を emit している定数が無い`).toContain(name);
    }
  });
});

describe("readEventNames", () => {
  it("定数の値を読む", () => {
    const source = 'pub const REPO_SNAPSHOT_UPDATED: &str = "repo_snapshot_updated";';

    expect(readEventNames(source)).toEqual(["repo_snapshot_updated"]);
  });
});

describe("readRegisteredCommands", () => {
  it("generate_handler! の中だけを読む", () => {
    const source = `
      fn other() { commands::settings::not_registered; }
      pub fn invoke_handler() {
        tauri::generate_handler![
            commands::settings::list_repos,
            commands::ops::fetch_repo,
        ]
      }
    `;

    expect(readRegisteredCommands(source)).toEqual(["list_repos", "fetch_repo"]);
  });

  it("generate_handler! が無ければ投げる", () => {
    expect(() => readRegisteredCommands("fn main() {}")).toThrow(/generate_handler/);
  });
});
