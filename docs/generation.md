# Text generation

How Rewrites, Command Mode and Instruct Mode get text from the local model (M3, RW-07). The
model is the cleanup model (`docs/cleanup.md`), in the same LLM utility process. Nothing
leaves the machine, and generated or selected text is never logged.

## Pieces

- `apps/desktop/src/main/generation/prompt.ts` builds the prompt: the engine's rules first,
  then style notes, Memory facts, up to two writing samples (1,500 characters each), the
  instruction, and an optional example. The text to work on is the user message, inside
  `<text>` tags. The instruction comes after the rules, so a Rewrite's own instruction cannot
  undo them.
- `apps/desktop/src/main/generation/output.ts` cleans the answer: an announcing first line
  ("Sure! Here is the rewritten text:"), `<text>` tags, code fences and wrapping quotes are
  removed. While streaming, the first line is held back until a preface can be recognised.
- `apps/desktop/src/main/generation/service.ts` runs a request: limits per kind, one retry
  when the answer only repeats the instruction (the panel is told to clear), and errors as
  codes with the messages in `packages/shared/src/generation.ts`.
- `LlmClient.generate` in `apps/desktop/src/main/cleanup/llm-client.ts` sends a `generate`
  request to the worker and passes streamed chunks on.
- `CleanupEngine.generate` runs it in a second context of 4,096 to 8,192 tokens, created on
  first use. Cleanup keeps its own small context, so its cached prompt is not disturbed.

## Limits

| Kind          | Output tokens | Time limit                |
| ------------- | ------------- | ------------------------- |
| Rewrite       | 4,000         | 20 s                      |
| Command Mode  | 2,000         | 5 s                       |
| Instruct Mode | 4,000         | 30 s, 20 s for follow-ups |

The time limit starts when the request reaches the model. A first load is not counted; the
caller shows "Loading model" meanwhile. A retry gets only the time left. When the prompt
leaves fewer than 128 tokens of room in the context, the request fails with `too-long`.

## Dictation comes first

One job uses the model at a time:

- A generation does not start while a cleanup or translation is running; it starts when they
  end.
- A dictation that needs the model stops a generation that has not produced anything yet
  (`preempted`, "Stopped for a dictation. Try again.").
- If the generation is already producing text, the dictation waits for it, but only within
  its own cleanup budget. When the budget runs out, the dictation uses the rules-only text
  and the generation carries on. A dictation is never slower because of a Rewrite.
- A new generation cancels the previous one (Regenerate, or another Rewrite).

## Errors

| Code            | Message                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `timeout`       | Taking too long. Try again or pick a smaller selection.                     |
| `empty`         | No result. Try Regenerate.                                                  |
| `model-missing` | The language model is not downloaded. Get it in Settings.                   |
| `memory`        | Not enough memory to run the language model. Close some apps and try again. |
| `preempted`     | Stopped for a dictation. Try again.                                         |
| `cancelled`     | Cancelled.                                                                  |
| `too-long`      | Select less text to rewrite (8,000 characters max).                         |

There is only one local model, so running out of memory cannot fall back to a smaller one
yet; the message asks the user to free memory.

## Benchmark

`node scripts/bench-generate.mjs` runs 30 Rewrite prompts (10 texts, 3 instructions) on the
real model. It reports the time to the first chunk and to the end, prefaces in the raw
answers and after cleaning, answers that repeat the instruction, and whether numbers, links
and email addresses were kept. Needs the model and Node 22.18+.
