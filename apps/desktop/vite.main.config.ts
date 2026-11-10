import { defineConfig } from "vite";

// Forge's Vite plugin supplies the entry, output format and externals.
// node-llama-cpp is an ES module with native binaries: it is loaded at run time, never bundled.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["node-llama-cpp"],
    },
  },
});
