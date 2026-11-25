import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { VitePlugin } from "@electron-forge/plugin-vite";
import {
  LLM_MODULES_DIR,
  copyRuntimePackages,
  includeLlamaOptional,
  includeLlamaOptionalWindows,
  runtimeClosure,
  skipLlamaFile,
} from "./packaging/runtime-modules.ts";

/** The command MCP clients launch; it relays stdio to the app's local socket (CN-11). */
const mcpShim = path.resolve("packaging/murmur-mcp");
/** On Windows the command is a launcher and a Node script, both run by the app's own Node. */
const mcpWindowsFiles = ["murmur-mcp.cmd", "murmur-mcp.cjs"].map((name) =>
  path.resolve("packaging", name),
);

/** Where `npm run publish:helper:win` puts the Windows helper: one file, so one hash covers it. */
const windowsHelperFolder = path.resolve("../../native/helper-win/publish");

/** Where `npm run build:helper` puts the Swift helper, relative to this directory. */
const helperBinary = path.resolve("../../native/helper-mac/.build/release/murmur-helper");

/**
 * The Windows installer (SW-13). It is signed when a certificate is given in the environment
 * (`MURMUR_WIN_CERT_FILE` and `MURMUR_WIN_CERT_PASSWORD`); without one it is built unsigned, which
 * is for testing the installer only and is never distributed.
 */
const certificateFile = process.env.MURMUR_WIN_CERT_FILE;
const certificatePassword = process.env.MURMUR_WIN_CERT_PASSWORD;

const config: ForgeConfig = {
  packagerConfig: {
    name: "Murmur",
    asar: true,
    // macOS shows this text in the microphone prompt. Without it the prompt cannot appear.
    extendInfo: {
      NSMicrophoneUsageDescription: "Murmur listens to your voice so it can turn it into text.",
    },
  },
  makers: [
    new MakerSquirrel({
      name: "Murmur",
      authors: "tirthfx",
      description: "Voice dictation and meeting notes",
      setupExe: "Murmur-Setup.exe",
      ...(certificateFile && certificatePassword ? { certificateFile, certificatePassword } : {}),
    }),
  ],
  hooks: {
    // Copies the built helper to Contents/Resources/helper/murmur-helper. If the helper
    // has not been built, the package is still made and the app shows the helper as unavailable.
    postPackage: async (_config, { outputPaths, platform }) => {
      if (platform === "win32") {
        // The cleanup model's runtime and the MCP command go under resources, outside the asar
        // archive, as on the Mac. The helper follows, with its hash beside it (SW-13).
        const llm = runtimeClosure("node-llama-cpp", process.cwd(), {
          includeOptional: includeLlamaOptionalWindows,
        });
        for (const outputPath of outputPaths) {
          const resources = path.join(outputPath, "resources");
          copyRuntimePackages(llm, path.join(resources, LLM_MODULES_DIR), skipLlamaFile);
          console.log(`[package] included ${llm.length} packages for the cleanup model`);
          const mcp = path.join(resources, "mcp");
          mkdirSync(mcp, { recursive: true });
          for (const file of mcpWindowsFiles) cpSync(file, path.join(mcp, path.basename(file)));
          console.log(`[package] included the MCP command at ${mcp}`);
        }
        // The Windows helper goes to resources/helper/murmur-helper.exe.
        const exe = path.join(windowsHelperFolder, "murmur-helper.exe");
        if (!existsSync(exe)) {
          console.warn(
            "[package] Windows helper not found; run `npm run publish:helper:win` to include it",
          );
          return;
        }
        for (const outputPath of outputPaths) {
          const target = path.join(outputPath, "resources", "helper");
          mkdirSync(target, { recursive: true });
          cpSync(exe, path.join(target, "murmur-helper.exe"));
          const hash = createHash("sha256").update(readFileSync(exe)).digest("hex");
          writeFileSync(
            path.join(target, "murmur-helper.exe.sha256"),
            `${hash}  murmur-helper.exe\n`,
          );
          console.log(`[package] included the Windows helper at ${target}`);
        }
        return;
      }
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
      // The MCP command goes to Contents/Resources/mcp/murmur-mcp, which clients can run.
      for (const outputPath of outputPaths) {
        const target = path.join(outputPath, "Murmur.app", "Contents", "Resources", "mcp");
        mkdirSync(target, { recursive: true });
        cpSync(mcpShim, path.join(target, "murmur-mcp"));
        chmodSync(path.join(target, "murmur-mcp"), 0o755);
        console.log(`[package] included the MCP command at ${path.join(target, "murmur-mcp")}`);
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
        // The app checks the helper against this hash before it launches it (SW-13).
        const hash = createHash("sha256").update(readFileSync(helperBinary)).digest("hex");
        writeFileSync(path.join(target, "murmur-helper.sha256"), `${hash}  murmur-helper\n`);
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
        {
          entry: "src/preload/instruct-preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/preload/focus-preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      // One renderer build with five pages: index.html (Hub), bar.html (Bar), rewrite.html and
      // instruct.html (the panels), focus.html (the Focus overlay).
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};

export default config;
