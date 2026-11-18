import { readFile, writeFile } from "node:fs/promises";

/** What the Hub remembers between runs (HB-01): its size, place and last page. */
export interface HubWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  page: string | null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_HUB_STATE: HubWindowState = {
  width: 1120,
  height: 720,
  x: null,
  y: null,
  page: null,
};

const PAGE_ID = /^[a-z-]{1,40}$/;

const isInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/** A saved state, with anything missing or odd replaced by the default. */
export function parseHubState(value: unknown, minWidth: number, minHeight: number): HubWindowState {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_HUB_STATE };
  const raw = value as Record<string, unknown>;
  const width = isInt(raw.width) ? Math.min(Math.max(raw.width, minWidth), 10_000) : null;
  const height = isInt(raw.height) ? Math.min(Math.max(raw.height, minHeight), 10_000) : null;
  const hasPlace = isInt(raw.x) && isInt(raw.y);
  return {
    width: width ?? DEFAULT_HUB_STATE.width,
    height: height ?? DEFAULT_HUB_STATE.height,
    x: hasPlace ? (raw.x as number) : null,
    y: hasPlace ? (raw.y as number) : null,
    page: typeof raw.page === "string" && PAGE_ID.test(raw.page) ? raw.page : null,
  };
}

/**
 * The saved place, or null when no display shows enough of the window's top edge to grab it
 * (a display was unplugged): the window then opens centred.
 */
export function placeOnScreen(
  state: HubWindowState,
  displays: Rect[],
): { x: number; y: number } | null {
  if (state.x === null || state.y === null) return null;
  const { x, y, width } = state;
  const visible = displays.some((area) => {
    const left = Math.max(x, area.x);
    const right = Math.min(x + width, area.x + area.width);
    return right - left >= 100 && y >= area.y && y + 40 <= area.y + area.height;
  });
  return visible ? { x, y } : null;
}

export interface HubStateStore {
  load(): Promise<HubWindowState>;
  /** Merges and writes after a short pause, so a drag writes once. */
  update(change: Partial<HubWindowState>): void;
  /** Writes any pending change now (quit). */
  flush(): Promise<void>;
}

export function createHubStateStore(deps: {
  file: string;
  minWidth: number;
  minHeight: number;
  logger: { warn(message: string): void };
  delayMs?: number;
}): HubStateStore {
  let state: HubWindowState = { ...DEFAULT_HUB_STATE };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  async function write(): Promise<void> {
    timer = null;
    if (!pending) return;
    pending = false;
    try {
      await writeFile(deps.file, JSON.stringify(state));
    } catch (error) {
      deps.logger.warn(`could not save the Hub window state: ${String(error)}`);
    }
  }

  return {
    async load() {
      try {
        state = parseHubState(
          JSON.parse(await readFile(deps.file, "utf8")),
          deps.minWidth,
          deps.minHeight,
        );
      } catch {
        state = { ...DEFAULT_HUB_STATE };
      }
      return { ...state };
    },
    update(change) {
      state = parseHubState({ ...state, ...change }, deps.minWidth, deps.minHeight);
      pending = true;
      if (timer === null) timer = setTimeout(() => void write(), deps.delayMs ?? 500);
    },
    async flush() {
      if (timer !== null) clearTimeout(timer);
      await write();
    },
  };
}
