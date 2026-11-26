/**
 * Interface text for Windows. The source says what a Mac calls things; a Windows build rewrites
 * those words while it bundles, so the Mac's text is untouched and nothing a person dictates or
 * records is ever rewritten (only the app's own source is). Every phrase here holds a space, so
 * no identifier in the code can match one. `windows-wording.test.ts` fails when a text with a
 * Mac word is not covered.
 */

/** Matches the phrase however the source breaks it over lines. */
const phrase = (text: string, flags = "g") =>
  new RegExp(
    text
      .split(" ")
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+"),
    flags,
  );

/** In order: whole sentences first, then the names. */
export const WINDOWS_PHRASES: readonly (readonly [RegExp, string])[] = [
  // Sentences that are not true on Windows.
  [phrase("macOS asks once for permission the first time one is shown."), ""],
  [
    phrase("macOS lists it as Screen & System Audio Recording. Murmur does not ask for it yet."),
    "Windows asks for no permission for this.",
  ],
  [phrase("three macOS permissions"), "a few permissions"],
  // Where saved sign-ins and tokens are.
  [/\bthe\s+Mac(?:'|’|&apos;)s\s+Keychain\b/g, "Windows Credential Manager"],
  [/\bthe\s+Keychain\b/g, "Windows Credential Manager"],
  // The computer.
  [/\b([Tt]his|[Tt]he|[Yy]our|owner(?:'|’|&apos;)s)(\s+)Mac\b/g, "$1$2PC"],
  // The system's own places.
  [/\bthe(\s+)menu(\s+)bar\b/g, "the$1notification$2area"],
  [/\bmenu(\s+)bar\b/g, "system$1tray"],
  [/\bSystem(\s+)Settings\b/g, "Windows$1Settings"],
  [/\b(in|In)(\s+)Finder\b/g, "$1$2File Explorer"],
  // The system's name, only as a word in a sentence.
  [/(?<=\s)macOS\b|\bmacOS(?=\s)/g, "Windows"],
];

export function windowsWording(source: string): string {
  return WINDOWS_PHRASES.reduce((text, [from, to]) => text.replace(from, to), source);
}

/**
 * The app's own source: the desktop app and the shared package, and nothing from a library. The
 * shared package is also seen through its workspace link (the page build keeps links as written).
 */
const OWN_SOURCE =
  /[\\/](apps[\\/]desktop|packages[\\/]shared|node_modules[\\/]@murmur[\\/]shared)[\\/]src[\\/].*\.tsx?$/;
const LIBRARY = /node_modules[\\/](?!@murmur[\\/]shared[\\/])/;

export function isOwnSource(id: string): boolean {
  return !LIBRARY.test(id) && OWN_SOURCE.test(id.split("?")[0]!);
}

/**
 * The Vite plugin, for a build made for Windows. A package is made on the system it is for, so
 * the build machine's system is the target; `MURMUR_TARGET_OS` overrides it.
 */
export function windowsWordingPlugin(targetOs: string) {
  return {
    name: "murmur:windows-wording",
    // Before JSX is compiled, so text between tags is still as written.
    enforce: "pre" as const,
    transform(code: string, id: string): { code: string; map: null } | null {
      if (targetOs !== "win32" || !isOwnSource(id)) return null;
      const changed = windowsWording(code);
      return changed === code ? null : { code: changed, map: null };
    },
  };
}
