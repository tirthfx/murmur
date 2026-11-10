import path from "node:path";

/**
 * Where speech models live: `<appData>/Murmur/models/speech/whisperkit`, with `appData` being
 * `~/Library/Application Support` on macOS. Fixed to "Murmur" so the dev build and the
 * packaged app share one copy of the large model.
 */
export function speechModelRoot(appData: string): string {
  return path.join(appData, "Murmur", "models", "speech", "whisperkit");
}

/** Where the cleanup language model lives: `<appData>/Murmur/models/llm`. */
export function cleanupModelRoot(appData: string): string {
  return path.join(appData, "Murmur", "models", "llm");
}
