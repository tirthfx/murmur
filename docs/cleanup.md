# Transcript cleanup

What happens to the text between transcription and insertion.

## Two stages

1. **Rules** (always, in main, `apps/desktop/src/main/cleanup/rules.ts`):
   - removes the fillers um, uh, er, erm, hmm and ah, and the commas that only surrounded them;
   - collapses repeated words ("I I think");
   - keeps only the corrected version after a correction cue: "at two, actually three" becomes "at three", "send it to Sam no wait to Priya" becomes "send it to Priya". Cues: actually, rather (only after a pause comma, so "it actually works" is kept), sorry (not after "I'm", "so" and similar, so apologies are kept), no wait, or rather, I mean, scratch that. "Scratch that" on its own removes the sentence before it. A cue with nothing before it stays as text;
   - capitalises sentence starts and the word I.
2. **Model** (optional): Qwen3 4B Instruct, 4-bit, run by node-llama-cpp in a separate utility process. It receives the rules' output and may only remove fillers and fix punctuation and capitals. Its answer is forced into `{"text": "..."}` and then checked: at Standard every word must come from the input, so an answer to the text, echoed instructions or a changed name or number is refused.

The model has 1.5 seconds, including loading. If it is slow, missing, crashes or its answer is refused, the rules' text is inserted. Insertion never waits on the model beyond the budget. The model starts loading when a recording starts and is stopped after 5 idle minutes to free its memory.

## Levels

`standard` is the default. `off` and `light` keep every word (spacing and capitals only; light lets the model add punctuation). `full` lets the model smooth run-on sentences with a few new words at most. A Settings switch comes with #13.

## Model files

```bash
npm run model:download -- cleanup
```

2.5 GB, checked by SHA-256 like the speech model. Without it, cleanup is rules only and the log says so.

## Measuring

```bash
node scripts/bench-cleanup.mjs
```

Runs a small corpus (including texts that try to make the model answer or follow instructions) and prints p50 and p90 latency against the budget, how often the model's answer was used, and checks that no final text contains prompt wording.

## Packaged builds

The packaged app does not include node-llama-cpp yet, so a packaged build cleans with rules only. Development (`npm run dev`) uses the model.

## Manual test

1. `npm run model:download`, `npm run build:helper`, `MURMUR_LOG_TRANSCRIPTS=1 npm run dev`.
2. In TextEdit dictate "Um, so I think, uh, we should go." The terminal shows `cleanup: model in … ms` (or `rules only` on the very first try while the model loads) and TextEdit gets "So I think we should go."
3. Dictate "Let's meet at two, actually three." and get "Let's meet at three."

## In the packaged app

Forge's Vite plugin bundles JavaScript and leaves `node_modules` out of the app, so
`npm run package` copies node-llama-cpp and everything it needs at run time to
`Murmur.app/Contents/Resources/llm-modules/node_modules` (about 43 MB, 117 packages). The
folder is outside the asar archive so the native library can load. Only the macOS arm64
Metal binaries are included, and the 35 MB llama.cpp source bundle is left out.

The cleanup process looks for that folder first and falls back to the normal `node_modules`
in development. The list of packages is worked out from the installed `package.json` files
(`apps/desktop/packaging/runtime-modules.ts`), so a node-llama-cpp update needs no manual
list.

Check a packaged build:

```bash
npm run build:helper
```

```bash
npm run package
```

```bash
npm run smoke -- --packaged
```

The run's log shows `cleanup: model in ... ms` once the model has loaded (the very first
dictation after a start may still say `rules only (timeout)` while the model loads). Without
the model file the packaged app cleans with rules only, as in development.
