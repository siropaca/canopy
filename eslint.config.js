import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// 生の HTML を差し込む経路。CSP は innerHTML を止めないので lint で塞ぐ (docs/security.md)
const htmlSinks = ["innerHTML", "outerHTML", "insertAdjacentHTML"].map((property) => ({
  property,
  message:
    "生の HTML を差し込まない。ブランチ名は外部由来で < > を含められる。表示は JSX に任せる (docs/security.md)",
}));

export default tseslint.config(
  {
    // 生成物とモックは対象外。モックは単体で完結した HTML なので lint しない
    ignores: ["dist", "src-tauri/**", "src/ipc/generated/**", "docs/**"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat["recommended-latest"],
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // 未使用は _ 始まりだけ許す
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // 握りつぶしを禁止する (AGENTS.md)
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-restricted-properties": ["error", ...htmlSinks],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            "スタイルは CSS Modules に寄せる。素の style 属性は CSP でも無効になる。仮想リストのように style で位置を渡すライブラリを使う箇所だけ、理由を書いて eslint-disable する (docs/security.md)",
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "外部由来の HTML を差し込まない。表示は JSX に任せる (docs/security.md)",
        },
      ],
    },
  },
  // 層をまたぐ import を止める。順序は app > features > store > ipc > shared
  // (docs/architecture.md の「ディレクトリ」)。型だけの ipc/generated はどの層からでも読める
  {
    files: ["src/shared/**"],
    rules: {
      // 型だけの import を許すために typescript-eslint 版を使う
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/**", "@/features/**", "@/store/**", "**/features/**"],
              message: "shared は app / features / store を知らない (docs/architecture.md)",
            },
            {
              // generated (型だけ) は許す。ipc/types.ts も型だけなので import type は許す。
              // 実行時の import (invoke のラッパ) は禁止
              regex: "^@/ipc/(?!generated/)",
              message:
                "shared は invoke を呼ばない。実行時に必要なら shared に上げる。型は import type で取る",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // 自分のスライス内は相対パスで書く。@/features/... と書けるのは features の外だけ
              group: ["@/features/**", "**/features/**"],
              message: "features 同士を直接参照しない。共有するなら shared に上げる",
            },
            { group: ["@/app/**"], message: "features は app を知らない" },
          ],
        },
      ],
    },
  },
  {
    files: ["src/ipc/**", "src/store/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/**", "@/features/**", "**/features/**"],
              message: "ipc / store は app と features を知らない (docs/architecture.md)",
            },
          ],
        },
      ],
    },
  },
  {
    // 設定ファイルとテストは Node で動く
    files: ["*.config.{js,ts}", "**/*.test.{ts,tsx}"],
    languageOptions: { globals: globals.node },
  },
  {
    // JS は tsconfig に含めていないので型を使うルールを外す
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
