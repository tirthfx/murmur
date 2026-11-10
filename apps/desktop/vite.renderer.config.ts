import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { buildCsp, injectCspMeta } from "./src/security/csp.ts";

/** Writes the Content-Security-Policy meta tag into the Hub page for this build mode. */
function contentSecurityPolicy(development: boolean): Plugin {
  return {
    name: "murmur:content-security-policy",
    transformIndexHtml: {
      order: "post",
      handler: (html) => injectCspMeta(html, buildCsp(development ? "development" : "production")),
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), contentSecurityPolicy(command === "serve")],
  build: {
    rollupOptions: {
      // The Hub and the Bar are two pages of one build, each with its own preload.
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        bar: fileURLToPath(new URL("./bar.html", import.meta.url)),
      },
    },
  },
}));
