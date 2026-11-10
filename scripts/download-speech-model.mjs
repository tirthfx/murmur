// Downloads the default speech model into Application Support and checks every file's
// SHA-256 against the manifest. Files already correct are kept, so it also repairs a copy
// that failed its check. Needs Node 22.18 or later (runs the app's TypeScript directly).
//
//   npm run model:download

import os from "node:os";
import path from "node:path";
import { DEFAULT_SPEECH_MODEL } from "../packages/shared/src/speech-models.ts";
import {
  checkModel,
  downloadModel,
  modelLocation,
} from "../apps/desktop/src/main/speech/model-store.ts";
import { speechModelRoot } from "../apps/desktop/src/main/speech/paths.ts";

const appData = path.join(os.homedir(), "Library", "Application Support");
const root = speechModelRoot(appData);
const model = DEFAULT_SPEECH_MODEL;
const { dir } = modelLocation(root, model);

const before = await checkModel(root, model);
if (before.ok) {
  console.log(`${model.label} is already downloaded and verified in ${dir}`);
  process.exit(0);
}

console.log(`Downloading ${model.label}, ${(model.totalBytes / 1e6).toFixed(0)} MB, to ${dir}`);
let lastPercent = -1;
const started = Date.now();
const downloaded = await downloadModel(root, model, {
  onProgress(done, total) {
    const percent = Math.floor((done / total) * 100);
    if (percent !== lastPercent && percent % 5 === 0) {
      lastPercent = percent;
      process.stdout.write(`  ${percent}%\n`);
    }
  },
});
const after = await checkModel(root, model);
if (!after.ok) {
  console.error(`The model still fails its ${after.reason} check (${after.file}).`);
  process.exit(1);
}
const seconds = ((Date.now() - started) / 1000).toFixed(0);
console.log(
  `Done: ${(downloaded / 1e6).toFixed(0)} MB downloaded in ${seconds} s, every file verified.`,
);
