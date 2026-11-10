import { z } from "zod";

/**
 * The Bar: a small floating pill that shows the dictation state. Main owns the state and
 * pushes a view to the Bar page; the page only reports drags and clicks.
 */

export const BAR_STATES = [
  "hidden",
  "idle",
  "listening",
  "locked",
  "processing",
  "done",
  "warning",
  "error",
  "cancelled",
] as const;
export type BarState = (typeof BAR_STATES)[number];

/** What the Bar page draws. */
export const barViewSchema = z.strictObject({
  state: z.enum(BAR_STATES),
  /** Epoch ms when recording started, for the elapsed time. */
  startedAt: z.number().nullable(),
  /** Word count in `done`. */
  words: z.number().int().nonnegative().nullable(),
  /** Text for `warning` and `error`. */
  message: z.string().nullable(),
});
export type BarView = z.infer<typeof barViewSchema>;

export const BAR_ERROR_TEXT = "Transcription failed. Tap to retry.";

/** Bar page to main. */
export const BAR_IPC_CHANNELS = {
  ready: "bar:ready",
  dragStart: "bar:drag-start",
  drag: "bar:drag",
  dragEnd: "bar:drag-end",
  click: "bar:click",
} as const;

/** Main to Bar page. */
export const BAR_PUSH_CHANNELS = {
  view: "bar:view",
  level: "bar:level",
} as const;

const offset = z.number().int().min(-20000).max(20000);

export const BAR_IPC_CONTRACT = {
  [BAR_IPC_CHANNELS.ready]: z.tuple([]),
  [BAR_IPC_CHANNELS.dragStart]: z.tuple([]),
  [BAR_IPC_CHANNELS.drag]: z.tuple([offset, offset]),
  [BAR_IPC_CHANNELS.dragEnd]: z.tuple([]),
  [BAR_IPC_CHANNELS.click]: z.tuple([]),
} as const;

export type BarIpcChannel = keyof typeof BAR_IPC_CONTRACT;

export function parseBarIpc(channel: string, args: readonly unknown[]): unknown[] | null {
  if (!Object.hasOwn(BAR_IPC_CONTRACT, channel)) return null;
  const parsed = BAR_IPC_CONTRACT[channel as BarIpcChannel].safeParse(args);
  return parsed.success ? (parsed.data as unknown[]) : null;
}

/** What the Bar preload exposes as `window.murmurBar`. */
export interface MurmurBarApi {
  /** Asks for the current view; later views arrive through `onView`. */
  ready(): Promise<BarView>;
  onView(handler: (view: BarView) => void): () => void;
  /** Input level while listening, in dBFS. */
  onLevel(handler: (rmsDb: number) => void): () => void;
  dragStart(): void;
  /** Total movement since `dragStart`, in screen points. */
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  click(): void;
}
