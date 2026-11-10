export const PROTOCOL_VERSION = 1;

export function isSupportedProtocolVersion(version: number): boolean {
  return version === PROTOCOL_VERSION;
}

export * from "./ipc";
