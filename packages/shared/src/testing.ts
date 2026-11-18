import { z } from "zod";

/**
 * Developer mode and the Testing page (HB-20, HB-53 to HB-57). Nothing here is sent
 * anywhere; the diagnostics bundle is a local folder made only when asked for.
 */

// ------------------------------------------------------------------ accessibility inspector

export const axInspectPayloadSchema = z.object({ showValues: z.boolean() });

export const inspectedNodeSchema = z.object({
  depth: z.number().int().min(0),
  role: z.string().nullable(),
  subrole: z.string().nullable(),
  title: z.string().nullable(),
  editable: z.boolean(),
  /** A secure field: never a value, never a range. */
  secure: z.boolean(),
  selectedRange: z.tuple([z.number(), z.number()]).nullable(),
  value: z.string().max(200).nullable(),
});
export type InspectedNode = z.infer<typeof inspectedNodeSchema>;

export const axInspectResultSchema = z.object({
  app: z.string().nullable(),
  bundleId: z.string().nullable(),
  nodes: z.array(inspectedNodeSchema).max(500),
  /** The 500-node or depth-6 limit cut the tree short. */
  truncated: z.boolean(),
});
export type AxInspectResult = z.infer<typeof axInspectResultSchema>;

// ------------------------------------------------------------------ developer settings

/** HB-57 engine switches; all off. */
export const developerSettingsSchema = z.strictObject({
  /** HB-20: shows the Testing page. */
  enabled: z.boolean(),
  /** Only the deterministic cleanup pass runs (no local model). */
  disableCleanup: z.boolean(),
  /** Typed insertion instead of paste. */
  forceTyped: z.boolean(),
  /** No text around the cursor is read. */
  disableContext: z.boolean(),
});
export type DeveloperSettings = z.infer<typeof developerSettingsSchema>;

export const DEFAULT_DEVELOPER: DeveloperSettings = {
  enabled: false,
  disableCleanup: false,
  forceTyped: false,
  disableContext: false,
};

/** HB-20: clicks on the version number that turn developer mode on. */
export const DEVELOPER_CLICKS = 5;

// ------------------------------------------------------------------ flag registry (HB-54)

/** One experimental flag: a key in `experimental.flags`, with what it is and who owns it. */
export interface FlagInfo {
  key: string;
  label: string;
  description: string;
  milestone: "M1" | "M2" | "M3";
  /** Off for every flag (HB-18). */
  default: boolean;
}

export const FLAG_REGISTRY: readonly FlagInfo[] = [
  {
    key: "splitMessages",
    label: "Split into messages",
    description: "Long dictations split at pauses (DC-37).",
    milestone: "M1",
    default: false,
  },
  {
    key: "pauseMedia",
    label: "Pause media",
    description: "Pause what is playing while dictating (DC-42).",
    milestone: "M1",
    default: false,
  },
  {
    key: "headsetWear",
    label: "Headset wear",
    description: "Switch microphones when a headset goes on or off (DC-14).",
    milestone: "M1",
    default: false,
  },
  {
    key: "ringMicrophone",
    label: "Ring microphone",
    description: "A Bluetooth ring as the microphone (DC-15).",
    milestone: "M1",
    default: false,
  },
  {
    key: "bulkImport",
    label: "Bulk import",
    description: "Import Dictionary entries and snippets from a file (PZ-07, PZ-10).",
    milestone: "M2",
    default: false,
  },
  {
    key: "phraseLearning",
    label: "Phrase learning",
    description: "Learn names of two to four words (PZ-05).",
    milestone: "M2",
    default: false,
  },
  {
    key: "styleDetection",
    label: "Style detection",
    description: "Pick the category from the field's content (PZ-14).",
    milestone: "M2",
    default: false,
  },
  {
    key: "pronunciationClips",
    label: "Pronunciation clips",
    description: "Record how a Dictionary entry sounds (PZ-06).",
    milestone: "M2",
    default: false,
  },
  {
    key: "commandMode",
    label: "Command Mode",
    description: "Spoken commands on the selection or last dictation (RW-08).",
    milestone: "M3",
    default: false,
  },
  {
    key: "autoInstruct",
    label: "Offer Instruct Mode",
    description: "Offer Instruct when a dictation reads like a request (RW-16).",
    milestone: "M3",
    default: false,
  },
  {
    key: "focusMode",
    label: "Focus Mode",
    description: "Block chosen apps and sites for a while (RW-18).",
    milestone: "M3",
    default: false,
  },
];

// ------------------------------------------------------------------ tools (HB-55)

export const TESTING_TOOLS = [
  "restartOnboarding",
  "resetPersonalisation",
  "testNotification",
  "cycleBar",
  "diagnostics",
] as const;
export type TestingTool = (typeof TESTING_TOOLS)[number];

export const testingToolResultSchema = z.strictObject({
  ok: z.boolean(),
  message: z.string(),
});
export type TestingToolResult = z.infer<typeof testingToolResultSchema>;
