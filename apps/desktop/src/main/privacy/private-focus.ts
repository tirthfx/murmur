import type { ContextSnapshotInput, FocusContext } from "@murmur/shared";

/**
 * HB-48: an app on the private list is never asked for the text around the caret. The app is
 * learned first, without any text, and the text is asked for only when it is not listed.
 */
export function createPrivateFocus(
  read: (input: ContextSnapshotInput) => Promise<FocusContext>,
  excluded: () => readonly string[],
): (input?: ContextSnapshotInput) => Promise<FocusContext> {
  const nothing = { maxBefore: 0, maxAfter: 0 };
  return async (input = {}) => {
    const list = excluded();
    if (list.length === 0) return read(input);
    const app = await read(nothing);
    const listed = new Set(list);
    if (app.bundleId !== null && listed.has(app.bundleId)) {
      return { ...app, windowTitle: null, textBefore: "", textAfter: "" };
    }
    return read(input);
  };
}
