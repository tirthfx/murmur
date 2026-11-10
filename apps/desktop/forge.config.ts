import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";

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
        { entry: "src/preload/preload.ts", config: "vite.preload.config.ts", target: "preload" },
        {
          entry: "src/preload/bar-preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      // One renderer build with two pages: index.html (Hub) and bar.html (Bar).
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};

export default config;
