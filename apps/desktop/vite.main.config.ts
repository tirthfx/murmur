import { defineConfig } from "vite";
import { targetOs } from "./packaging/target-os.ts";
import { windowsWordingPlugin } from "./packaging/windows-wording.ts";

// Forge's Vite plugin supplies the entry, output format and externals.
// node-llama-cpp is an ES module with native binaries: it is loaded at run time, never bundled.
export default defineConfig({
  plugins: [windowsWordingPlugin(targetOs())],
  build: {
    rollupOptions: {
      external: ["node-llama-cpp"],
    },
  },
});
