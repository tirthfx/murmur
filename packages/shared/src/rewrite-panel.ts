import { z } from "zod";

// The Rewrite panel (RW-01): a small window near the Bar that lists Rewrites for the selected
// text, streams the result, and replaces the selection. Main owns the session; the panel
// page only shows the state and sends the user's choices.

/** The hotkey binding's `rewriteId` that opens the panel instead of running one Rewrite. */
export const REWRITE_PANEL_BINDING_ID = "panel";

export const REWRITE_PANEL_SIZE = { width: 420, height: 380 } as const;

export interface RewritePanelItem {
  id: string;
  name: string;
  /** The built-in's description, or the start of a custom instruction. */
  detail: string;
}

export type RewritePanelState =
  | { stage: "hidden" }
  | {
      stage: "list";
      items: RewritePanelItem[];
      /** Characters selected, for the header. */
      selectionLength: number;
      appName: string | null;
    }
  | {
      stage: "running";
      rewriteName: string;
      /** Output so far. */
      text: string;
      loading: boolean;
    }
  | {
      stage: "result";
      rewriteName: string;
      text: string;
      /** The selected text, for "View changes" (RW-06). */
      source: string;
    }
  | {
      stage: "message";
      message: string;
      /** Offer Copy (the last result) beside Close, for example when the selection changed. */
      canCopy: boolean;
      /** Offer going back to the list. */
      canRetry: boolean;
    };

export const REWRITE_PANEL_CHANNELS = {
  ready: "rewrite-panel:ready",
  choose: "rewrite-panel:choose",
  regenerate: "rewrite-panel:regenerate",
  back: "rewrite-panel:back",
  replace: "rewrite-panel:replace",
  copy: "rewrite-panel:copy",
  close: "rewrite-panel:close",
} as const;

export const REWRITE_PANEL_PUSH = { state: "rewrite-panel:state" } as const;

/** Arguments the panel may send, checked in main. */
export const REWRITE_PANEL_ARGS = {
  [REWRITE_PANEL_CHANNELS.ready]: z.tuple([]),
  [REWRITE_PANEL_CHANNELS.choose]: z.tuple([z.string().min(1).max(64)]),
  [REWRITE_PANEL_CHANNELS.regenerate]: z.tuple([]),
  [REWRITE_PANEL_CHANNELS.back]: z.tuple([]),
  [REWRITE_PANEL_CHANNELS.replace]: z.tuple([]),
  [REWRITE_PANEL_CHANNELS.copy]: z.tuple([]),
  [REWRITE_PANEL_CHANNELS.close]: z.tuple([]),
} as const;

/** What the panel's preload exposes as `window.murmurRewrite`. */
export interface MurmurRewriteApi {
  ready(): Promise<RewritePanelState>;
  onState(handler: (state: RewritePanelState) => void): () => void;
  choose(rewriteId: string): Promise<void>;
  regenerate(): Promise<void>;
  /** Back to the list ("Try another Rewrite"). */
  back(): Promise<void>;
  replace(): Promise<void>;
  copy(): Promise<void>;
  /** Escape or Discard. */
  close(): Promise<void>;
}

/** The panel's messages (RW-01). */
export const REWRITE_PANEL_MESSAGES = {
  noSelection: "Select some text first",
  tooLong: "Select less text to rewrite (8,000 characters max).",
  secure: "Rewrites do not read password fields",
  selectionChanged: "Selection changed. Copy instead?",
  notBack: "Could not get back to the app. The result was copied instead.",
  noRewrites: "All Rewrites are switched off. Switch one on in the Hub.",
  replaced: "Replaced",
  copied: "Copied",
} as const;
