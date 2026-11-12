import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";
import {
  LLM_MODULES_DIR,
  copyRuntimePackages,
  includeLlamaOptional,
  runtimeClosure,
  skipLlamaFile,
} from "./packaging/runtime-modules.ts";

/** Where `npm run build:helper` puts the Swift helper, relative to this directory. */
const helperBinary = path.resolve("../../native/helper-mac/.build/release/murmur-helper");

const config: ForgeConfig = {
  packagerConfig: {
    name: "Murmur",
    asar: true,
    // macOS shows this text in the microphone prompt. Without it the prompt cannot appear.
    extendInfo: {
      NSMicrophoneUsageDescription: "Murmur listens to your voice so it can turn it into text.",
    },
  },
  hooks: {
    // Copies the built helper to Contents/Resources/helper/murmur-helper. If the helper
    // has not been built, the package is still made and the app shows the helper as unavailable.
    postPackage: async (_config, { outputPaths, platform }) => {
      if (platform !== "darwin") return;
      // The cleanup model's runtime (node-llama-cpp and what it needs) goes next to the app,
      // outside the asar archive, so its native library can load.
      const llm = runtimeClosure("node-llama-cpp", process.cwd(), {
        includeOptional: includeLlamaOptional,
      });
      for (const outputPath of outputPaths) {
        const target = path.join(
          outputPath,
          "Murmur.app",
          "Contents",
          "Resources",
          LLM_MODULES_DIR,
        );
        copyRuntimePackages(llm, target, skipLlamaFile);
        console.log(`[package] included ${llm.length} packages for the cleanup model at ${target}`);
      }
      if (!existsSync(helperBinary)) {
        console.warn(
          "[package] helper binary not found; run `npm run build:helper` to include it in the app",
        );
        return;
      }
      for (const outputPath of outputPaths) {
        const target = path.join(outputPath, "Murmur.app", "Contents", "Resources", "helper");
        mkdirSync(target, { recursive: true });
        cpSync(helperBinary, path.join(target, "murmur-helper"));
        console.log(`[package] included helper at ${path.join(target, "murmur-helper")}`);
      }
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/main.ts", config: "vite.main.config.ts", target: "main" },
        // The cleanup model's utility process.
        { entry: "src/llm/llm-worker.ts", config: "vite.main.config.ts", target: "main" },
        { entry: "src/preload/preload.ts", config: "vite.preload.config.ts", target: "preload" },
        {
          entry: "src/preload/bar-preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/preload/rewrite-preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      // One renderer build with three pages: index.html (Hub), bar.html (Bar), rewrite.html.
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};

export default config;
