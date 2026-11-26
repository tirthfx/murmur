import { z } from "zod";
import type { SoundName } from "./settings";

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
  /** A yes-or-no question, such as "Save to Memory?" (PZ-19). */
  "ask",
] as const;
export type BarState = (typeof BAR_STATES)[number];

/** What a Bar question can be answered with. Yes and No unless a question gives buttons. */
export const BAR_ANSWERS = ["yes", "no", "never"] as const;
export type BarAnswer = (typeof BAR_ANSWERS)[number];

/** What the Bar page draws. */
export const barViewSchema = z.strictObject({
  state: z.enum(BAR_STATES),
  /** Epoch ms when recording started, for the elapsed time. */
  startedAt: z.number().nullable(),
  /** Word count in `done`. */
  words: z.number().int().nonnegative().nullable(),
  /** Text for `warning`, `error` and `ask`. */
  message: z.string().nullable(),
  /** The second line of `ask`: what the question is about. */
  detail: z.string().nullable().optional(),
  /** Buttons for `ask`, in order, up to three. Without them: Save and Dismiss (PZ-19). */
  actions: z
    .array(
      z.strictObject({
        answer: z.enum(BAR_ANSWERS),
        label: z.string().min(1).max(30),
        /** Spoken name when the label is short ("Never" for "Never for this app"). */
        hint: z.string().max(60).optional(),
        primary: z.boolean().optional(),
      }),
    )
    .max(3)
    .optional(),
  /** Focus Mode is on (RW-18): when it ends, or null until turned off. Shown while idle. */
  focus: z.strictObject({ endsAt: z.number().nullable() }).nullable().optional(),
  /** A meeting is being recorded (NT-04): a red dot in every state, and its time while idle. */
  meeting: z.strictObject({ startedAt: z.number() }).nullable().optional(),
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
  /** The answer to an `ask`. */
  answer: "bar:answer",
  /** A right click: show the Bar's menu (DC-46). */
  menu: "bar:menu",
} as const;

/** Main to Bar page. */
export const BAR_PUSH_CHANNELS = {
  view: "bar:view",
  level: "bar:level",
  sound: "bar:sound",
} as const;

const offset = z.number().int().min(-20000).max(20000);

export const BAR_IPC_CONTRACT = {
  [BAR_IPC_CHANNELS.ready]: z.tuple([]),
  [BAR_IPC_CHANNELS.dragStart]: z.tuple([]),
  [BAR_IPC_CHANNELS.drag]: z.tuple([offset, offset]),
  [BAR_IPC_CHANNELS.dragEnd]: z.tuple([]),
  [BAR_IPC_CHANNELS.click]: z.tuple([]),
  [BAR_IPC_CHANNELS.answer]: z.tuple([z.enum(BAR_ANSWERS)]),
  [BAR_IPC_CHANNELS.menu]: z.tuple([]),
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
  /** A feedback sound to play now. */
  onSound(handler: (name: SoundName) => void): () => void;
  dragStart(): void;
  /** Total movement since `dragStart`, in screen points. */
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  click(): void;
  /** A right click on the Bar (DC-46). */
  menu(): void;
  /** The answer to the question the Bar shows. */
  answer(choice: BarAnswer): void;
}
