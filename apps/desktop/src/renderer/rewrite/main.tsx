import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "../hub/fonts/fonts.css";
import "./rewrite.css";
import { RewritePanel } from "./RewritePanel";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
const api = window.murmurRewrite;

createRoot(container).render(
  <StrictMode>{api ? <RewritePanel api={api} /> : <p>Open this page from Murmur.</p>}</StrictMode>,
);
