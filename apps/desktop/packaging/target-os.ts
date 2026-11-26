/** The system a build is made for: packages are made on the system they are for. */
export function targetOs(): string {
  return process.env["MURMUR_TARGET_OS"] ?? process.platform;
}
