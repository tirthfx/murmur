// Downloads the default models (speech, then text cleanup) into Application Support and
// checks every file's SHA-256 against the manifests. Files already correct are kept, so
// it also repairs a copy that failed its check. Needs Node 22.18 or later (runs the app's
// TypeScript directly).
//
//   npm run model:download            both models
//   npm run model:download -- speech  one of them (speech or cleanup)
//   npm run model:download -- quality Instruct Mode's Quality model (5 GB, never by default)

import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CLEANUP_MODEL,
  QUALITY_INSTRUCT_MODEL,
} from "../packages/shared/src/llm-models.ts";
import { DEFAULT_SPEECH_MODEL } from "../packages/shared/src/speech-models.ts";
import {
  checkModel,
  downloadModel,
  modelLocation,
} from "../apps/desktop/src/main/speech/model-store.ts";
import { cleanupModelRoot, speechModelRoot } from "../apps/desktop/src/main/speech/paths.ts";

const appData = path.join(os.homedir(), "Library", "Application Support");
const targets = {
  speech: { root: speechModelRoot(appData), model: DEFAULT_SPEECH_MODEL },
  cleanup: { root: cleanupModelRoot(appData), model: DEFAULT_CLEANUP_MODEL },
  quality: { root: cleanupModelRoot(appData), model: QUALITY_INSTRUCT_MODEL },
};
const wanted = process.argv[2] ? [process.argv[2]] : ["speech", "cleanup"];

for (const name of wanted) {
  const target = targets[name];
  if (!target) {
    console.error(`Unknown model "${name}". Use one of: ${Object.keys(targets).join(", ")}`);
    process.exit(1);
  }
  await fetchModel(target.root, target.model);
}

async function fetchModel(root, model) {
  const { dir } = modelLocation(root, model);
  if ((await checkModel(root, model)).ok) {
    console.log(`${model.label} is already downloaded and verified in ${dir}`);
    return;
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
    console.error(`${model.label} still fails its ${after.reason} check (${after.file}).`);
    process.exit(1);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `Done: ${(downloaded / 1e6).toFixed(0)} MB downloaded in ${seconds} s, every file verified.`,
  );
}
