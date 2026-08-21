import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import tauriConfig from "./src-tauri/tauri.conf.json" with { type: "json" };

// Tauri から起動されるので、ポートは固定して勝手に変えさせない
const DEV_PORT = 1420;

// Tauri は devUrl を直接読ませるため、開発時は tauri.conf.json の devCsp が WebView に届かない。
// dev サーバ側で同じ文字列をヘッダとして返して、CSP 違反を開発中に見つけられるようにする。
// 値は tauri.conf.json を単一の情報源にする (docs/security.md)
const DEV_CSP = tauriConfig.app.security.devCsp;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Tauri の CLI が出すログを消さない
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    headers: { "Content-Security-Policy": DEV_CSP },
    // Rust 側の変更でフロントを再読み込みさせない
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // macOS 14 の WKWebView だけが対象。tauri.conf.json の minimumSystemVersion と揃える
    // (docs/adr/0014-macos-only.md)
    target: "safari17",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
