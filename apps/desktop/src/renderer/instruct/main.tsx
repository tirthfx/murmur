import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "../hub/fonts/fonts.css";
import "../rewrite/rewrite.css";
import "./instruct.css";
import { InstructPanel } from "./InstructPanel";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
const api = window.murmurInstruct;

createRoot(container).render(
  <StrictMode>{api ? <InstructPanel api={api} /> : <p>Open this page from Murmur.</p>}</StrictMode>,
);
