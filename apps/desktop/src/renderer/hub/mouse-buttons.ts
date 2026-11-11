/**
 * Mouse buttons as the browser reports them (`MouseEvent.button`: 0 left, 1 middle, 2 right,
 * 3 back, 4 forward) and as the helper binds them (CoreGraphics: 2 middle, 3 back,
 * 4 forward). Left and right are never offered.
 */
export function buttonFromBrowser(button: number): number | null {
  if (button === 1) return 2;
  if (button >= 3) return button;
  return null;
}

export function mouseButtonLabel(button: number | null): string {
  if (button === null) return "Not set";
  if (button === 2) return "Middle button";
  if (button === 3) return "Back button";
  if (button === 4) return "Forward button";
  return `Mouse button ${button + 1}`;
}
