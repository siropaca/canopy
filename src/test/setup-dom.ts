// jsdom を使うテストの共通後始末。
// globals を有効にしていないので、React Testing Library の自動 cleanup が効かない。
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
