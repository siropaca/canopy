import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

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
