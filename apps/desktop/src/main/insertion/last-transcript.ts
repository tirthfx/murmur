import type { FocusContext, InsertTextResult } from "@murmur/shared";
import type { Logger } from "../helper/types";

/**
 * Copy and paste the last transcript (DC-39). "Last" is the newest dictation with text. With
 * history storage off nothing is written to disk, so the newest text is held here until quit.
 */

export const NOTHING_YET = "Nothing dictated yet";
export const COPIED = "Copied";

export interface LastTranscriptDeps {
  /** The newest stored transcript, or null. */
  stored(): string | null;
  /** The focused field, or null when it cannot be read. */
  focus(): Promise<FocusContext | null>;
  insert(text: string): Promise<InsertTextResult>;
  copy(text: string): Promise<unknown>;
  /** A dictation is recording or being processed; nothing is pasted into the middle of it. */
  busy(): boolean;
  notify(kind: "note" | "warn", message: string): void;
  logger: Logger;
}

export interface LastTranscript {
  /** Called for each dictation with text: whether history kept it. */
  remember(text: string, stored: boolean): void;
  /** Drops what is held in memory, when the person deletes their data. */
  forget(): void;
  read(): string | null;
  copy(): Promise<void>;
  paste(): Promise<void>;
}

export function createLastTranscript(deps: LastTranscriptDeps): LastTranscript {
  /** Only a transcript that history did not keep; a newer stored one replaces it. */
  let unstored: string | null = null;
  let pasting = false;

  const read = (): string | null => unstored ?? deps.stored();

  async function copyText(text: string, message: string, kind: "note" | "warn"): Promise<void> {
    try {
      await deps.copy(text);
      deps.notify(kind, message);
    } catch (error) {
      deps.logger.warn(`could not copy: ${error instanceof Error ? error.message : String(error)}`);
      deps.notify("warn", "The text could not be copied");
    }
  }

  return {
    remember(text, stored) {
      if (text === "") return;
      unstored = stored ? null : text;
    },
    forget() {
      unstored = null;
    },
    read,
    async copy() {
      const text = read();
      if (text === null) return deps.notify("warn", NOTHING_YET);
      await copyText(text, COPIED, "note");
    },
    async paste() {
      // A second press while the first paste runs would insert the text twice.
      if (pasting || deps.busy()) return;
      const text = read();
      if (text === null) return deps.notify("warn", NOTHING_YET);
      pasting = true;
      try {
        const focus = await deps.focus().catch(() => null);
        // Nothing has the focus at all: the paste would go nowhere.
        if (focus && focus.role === null && !focus.editable) {
          await copyText(text, "Copied: no text field to paste into", "warn");
          return;
        }
        await deps.insert(text);
        deps.logger.info("pasted the last transcript");
      } catch (error) {
        deps.logger.warn(
          `could not paste: ${error instanceof Error ? error.message : String(error)}`,
        );
        await copyText(text, "Copied: the text could not be pasted", "warn");
      } finally {
        pasting = false;
      }
    },
  };
}
