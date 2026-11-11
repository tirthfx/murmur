import { z } from "zod";

/** Output mute while dictating (DC-41). */
export const mediaStatusResultSchema = z.object({
  playing: z.union([z.boolean(), z.literal("unknown")]),
  /** Null when the output device has no mute switch. */
  outputMuted: z.boolean().nullable(),
});
export type MediaStatus = z.infer<typeof mediaStatusResultSchema>;

export const mediaMutePayloadSchema = z.object({ muted: z.boolean() });
export const mediaMuteResultSchema = z.object({ previousMuted: z.boolean() });
