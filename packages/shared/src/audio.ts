import { z } from "zod";

/**
 * Microphone capture messages. Audio itself never crosses the protocol: the helper writes
 * it to a file and main only gets levels, the silent warning and the file reference.
 */

/** Session ids become file names in the helper, so the character set is limited. */
export const audioSessionIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/);

export const AUDIO_TRANSPORTS = ["builtin", "usb", "bluetooth", "virtual", "other"] as const;

export const audioDeviceSchema = z.object({
  /** Stable id of the device (Core Audio UID on macOS). */
  id: z.string().min(1),
  name: z.string(),
  isDefault: z.boolean(),
  transport: z.enum(AUDIO_TRANSPORTS),
  sampleRate: z.number().int().nonnegative(),
});
export type AudioDevice = z.infer<typeof audioDeviceSchema>;

export const audioDevicesResultSchema = z.object({ devices: z.array(audioDeviceSchema) });

export const audioStartPayloadSchema = z.object({
  sessionId: audioSessionIdSchema,
  /** A device id from `audio.devices`, or null for the system default. */
  deviceId: z.string().min(1).max(512).nullable().optional(),
  emitLevels: z.boolean(),
  levelIntervalMs: z.number().int().min(20).max(5000),
  /** Whisper mode (DC-12): up to +30 dB of gain, quieter speech still counts. */
  whisper: z.boolean().optional(),
  /** Microphone check (DC-13): nothing is written. */
  test: z.boolean().optional(),
});
export type AudioStartInput = z.infer<typeof audioStartPayloadSchema>;

export const audioStartResultSchema = z.object({
  startedAt: z.number().int().nonnegative(),
  sampleRate: z.literal(16000),
  channels: z.literal(1),
  deviceName: z.string(),
});
export type AudioStartResult = z.infer<typeof audioStartResultSchema>;

export const audioSessionPayloadSchema = z.object({ sessionId: audioSessionIdSchema });

export const AUDIO_CODECS = ["pcm_s16le", "opus"] as const;

export const audioFileSchema = z.object({
  path: z.string().min(1),
  codec: z.enum(AUDIO_CODECS),
  bytes: z.number().int().nonnegative(),
});
export type AudioFile = z.infer<typeof audioFileSchema>;

export const audioStopResultSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  /** Samples written at 16 kHz. */
  samples: z.number().int().nonnegative(),
  peakDb: z.number(),
  meanDb: z.number(),
  /** True when nothing above the silence threshold was heard in the whole session. */
  silent: z.boolean(),
  /** Null when no audio was written. */
  audioFile: audioFileSchema.nullable(),
  /** Background level of the input before gain (quietest tenth); null when empty. */
  inputNoiseDb: z.number().nullable().optional(),
  /** Speech level of the input before gain (loudest tenth); null when empty. */
  inputSpeechDb: z.number().nullable().optional(),
});
export type AudioStopResult = z.infer<typeof audioStopResultSchema>;

export const audioCancelResultSchema = z.object({ discarded: z.boolean() });

export const audioLevelPayloadSchema = z.object({
  sessionId: z.string(),
  source: z.enum(["mic", "system"]),
  rmsDb: z.number(),
  peakDb: z.number(),
  at: z.number().int().nonnegative(),
});
export type AudioLevel = z.infer<typeof audioLevelPayloadSchema>;

/** Sent once per session when the first 3 s stay below the silence threshold. */
export const audioSilentPayloadSchema = z.object({
  sessionId: z.string(),
  elapsedMs: z.number().int().nonnegative(),
  deviceName: z.string().optional(),
});
export type AudioSilent = z.infer<typeof audioSilentPayloadSchema>;

/** The connected inputs changed (plugged in, removed, new default). Sent at any time. */
export const audioDevicesChangedPayloadSchema = z.object({ devices: z.array(audioDeviceSchema) });
export type AudioDevicesChanged = z.infer<typeof audioDevicesChangedPayloadSchema>;

/**
 * A running session moved to another input because its device was removed or capture was
 * interrupted (DC-10, DC-16). Recording goes on into the same file. `deviceName` is null
 * when no input could be started.
 */
export const audioRouteChangedPayloadSchema = z.object({
  sessionId: z.string(),
  reason: z.enum(["device-removed", "interrupted"]),
  deviceName: z.string().nullable(),
});
export type AudioRouteChanged = z.infer<typeof audioRouteChangedPayloadSchema>;
