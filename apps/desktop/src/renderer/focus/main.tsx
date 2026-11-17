import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "../hub/fonts/fonts.css";
import "./focus.css";
import { FocusOverlay } from "./FocusOverlay";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
const api = window.murmurFocus;

createRoot(container).render(
  <StrictMode>{api ? <FocusOverlay api={api} /> : <p>Open this page from Murmur.</p>}</StrictMode>,
);
