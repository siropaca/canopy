import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// 自前スクロールバーの土台。ライブラリの CSS を読むのはここだけ
import "overlayscrollbars/overlayscrollbars.css";

import "@/shared/styles/tokens.css";
import "@/shared/styles/reset.css";

import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root が index.html に無い");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
