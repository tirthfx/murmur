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
  // `@murmur/shared` is our own source, not a library: pre-building it would cache an old copy,
  // and the Hub would crash on the next new export. Its own dependency, zod, is pre-built.
  optimizeDeps: {
    exclude: ["@murmur/shared"],
    include: ["zod"],
  },
  build: {
    rollupOptions: {
      // The Hub, the Bar and the Rewrite panel are pages of one build, each with its own preload.
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        bar: fileURLToPath(new URL("./bar.html", import.meta.url)),
        rewrite: fileURLToPath(new URL("./rewrite.html", import.meta.url)),
      },
    },
  },
}));
