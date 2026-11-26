import { defineConfig } from "vite";
import { targetOs } from "./packaging/target-os.ts";
import { windowsWordingPlugin } from "./packaging/windows-wording.ts";

// Forge's Vite plugin supplies the entry, output format and externals.
export default defineConfig({ plugins: [windowsWordingPlugin(targetOs())] });
