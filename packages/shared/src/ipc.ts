import { z } from "zod";
import { helperStatusSchema, type HelperStatus } from "./platform-helper";

/**
 * Renderer-to-main IPC contract. Channel names, payload schemas and the API the
 * preload exposes all live here so main, preload and renderer cannot drift.
 */

export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  getHelperStatus: "helper:get-status",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/** Per-channel schema for the arguments a renderer may send, and for the reply main returns. */
export const IPC_CONTRACT = {
  [IPC_CHANNELS.getAppInfo]: {
    args: z.tuple([]),
    result: appInfoSchema,
  },
  [IPC_CHANNELS.getHelperStatus]: {
    args: z.tuple([]),
    result: helperStatusSchema,
  },
} as const satisfies Record<IpcChannel, { args: z.ZodType; result: z.ZodType }>;

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === "string" && Object.values<string>(IPC_CHANNELS).includes(value);
}

export type IpcRequestResult =
  { ok: true; args: unknown[] } | { ok: false; reason: "unknown-channel" | "invalid-args" };

/**
 * Validates the arguments of an inbound IPC call. The failure reason never
 * includes the payload, so callers can log it without leaking content.
 */
export function parseIpcRequest(channel: unknown, args: readonly unknown[]): IpcRequestResult {
  if (!isIpcChannel(channel)) {
    return { ok: false, reason: "unknown-channel" };
  }
  const parsed = IPC_CONTRACT[channel].args.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-args" };
  }
  return { ok: true, args: parsed.data as unknown[] };
}

/** The API the preload script exposes to the renderer as `window.murmur`. */
export interface MurmurApi {
  getAppInfo(): Promise<AppInfo>;
  getHelperStatus(): Promise<HelperStatus>;
}
