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

/** Pause media while dictating (DC-42, experimental). */
export const mediaPlaybackResultSchema = z.object({
  /** False when the system does not tell Murmur what is playing. */
  available: z.boolean(),
  playing: z.boolean().nullable(),
});
export type MediaPlayback = z.infer<typeof mediaPlaybackResultSchema>;
/** `paused` is true only when something was playing and Murmur paused it. */
export const mediaPauseResultSchema = z.object({ paused: z.boolean() });
export const mediaResumeResultSchema = z.object({ resumed: z.boolean() });
