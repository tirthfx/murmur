/**
 * Where the Bar sits. Saved relative to a display's work area, so it survives a change of
 * resolution, and checked on restore so it never lands off screen.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayArea {
  id: number;
  workArea: Rect;
}

export interface SavedPosition {
  displayId: number;
  /** 0 = left edge of the work area, 1 = right edge (for the Bar's left side). */
  rx: number;
  /** 0 = top, 1 = bottom. */
  ry: number;
}

export const BAR_WIDTH = 280;
export const BAR_HEIGHT = 56;
/** Default: bottom centre, 24 px above the bottom edge (DC-07). */
export const BOTTOM_MARGIN = 24;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

export function defaultPosition(area: DisplayArea): { x: number; y: number } {
  const { workArea } = area;
  return {
    x: Math.round(workArea.x + (workArea.width - BAR_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - BAR_HEIGHT - BOTTOM_MARGIN),
  };
}

export function toSaved(
  point: { x: number; y: number },
  displays: DisplayArea[],
): SavedPosition | null {
  const centre = { x: point.x + BAR_WIDTH / 2, y: point.y + BAR_HEIGHT / 2 };
  const area =
    displays.find(
      ({ workArea: a }) =>
        centre.x >= a.x && centre.x < a.x + a.width && centre.y >= a.y && centre.y < a.y + a.height,
    ) ?? displays[0];
  if (!area) return null;
  const { workArea: a } = area;
  const spanX = Math.max(1, a.width - BAR_WIDTH);
  const spanY = Math.max(1, a.height - BAR_HEIGHT);
  return {
    displayId: area.id,
    rx: clamp((point.x - a.x) / spanX, 0, 1),
    ry: clamp((point.y - a.y) / spanY, 0, 1),
  };
}

/** The saved spot on its display if that display is still there, else the default on the primary. */
export function restorePosition(
  saved: SavedPosition | null,
  displays: DisplayArea[],
  primary: DisplayArea,
): { x: number; y: number } {
  const area = saved && displays.find((display) => display.id === saved.displayId);
  if (!saved || !area) return defaultPosition(primary);
  const { workArea: a } = area;
  return {
    x: Math.round(a.x + clamp(saved.rx, 0, 1) * Math.max(0, a.width - BAR_WIDTH)),
    y: Math.round(a.y + clamp(saved.ry, 0, 1) * Math.max(0, a.height - BAR_HEIGHT)),
  };
}

export function parseSaved(value: unknown): SavedPosition | null {
  if (typeof value !== "object" || value === null) return null;
  const { displayId, rx, ry } = value as Record<string, unknown>;
  if (typeof displayId !== "number" || typeof rx !== "number" || typeof ry !== "number")
    return null;
  if (![rx, ry].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  return { displayId, rx, ry };
}
