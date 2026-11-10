/**
 * The single source of the helper protocol version on the TypeScript side. The Swift
 * constant lives in `native/helper-mac/Sources/MurmurHelperCore/ProtocolConstants.swift`;
 * a test fails if the two differ.
 */
export const PROTOCOL_VERSION = 1;

export function isSupportedProtocolVersion(version: number): boolean {
  return version === PROTOCOL_VERSION;
}
