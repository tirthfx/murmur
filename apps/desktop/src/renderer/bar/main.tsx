import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../hub/fonts/fonts.css";
import "./bar.css";
import { BarApp, BarGallery } from "./BarApp";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

// In the app the preload provides `murmurBar`. Opened in a plain browser during
// development, the page shows every state instead.
const api = window.murmurBar;
if (!api) document.documentElement.dataset.gallery = "true";

createRoot(container).render(
  <StrictMode>{api ? <BarApp api={api} /> : <BarGallery />}</StrictMode>,
);
