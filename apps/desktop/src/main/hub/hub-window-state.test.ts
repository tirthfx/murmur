import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HUB_STATE,
  createHubStateStore,
  parseHubState,
  placeOnScreen,
} from "./hub-window-state";

describe("parseHubState", () => {
  it("falls back to the defaults for anything odd", () => {
    expect(parseHubState(null, 960, 640)).toEqual(DEFAULT_HUB_STATE);
    expect(parseHubState({ width: "big", page: "../x" }, 960, 640)).toEqual(DEFAULT_HUB_STATE);
  });

  it("keeps a valid state and raises a size below the minimum", () => {
    expect(
      parseHubState({ width: 500, height: 900, x: 10, y: 20, page: "history" }, 960, 640),
    ).toEqual({ width: 960, height: 900, x: 10, y: 20, page: "history" });
  });

  it("drops a place with only one coordinate", () => {
    expect(parseHubState({ x: 10 }, 960, 640).x).toBeNull();
  });
});

describe("placeOnScreen", () => {
  const display = { x: 0, y: 0, width: 1440, height: 900 };
  const state = { ...DEFAULT_HUB_STATE, x: 100, y: 100 };

  it("keeps a place on a connected display", () => {
    expect(placeOnScreen(state, [display])).toEqual({ x: 100, y: 100 });
  });

  it("drops a place on a display that is gone", () => {
    expect(placeOnScreen({ ...state, x: 3000 }, [display])).toBeNull();
    expect(placeOnScreen(DEFAULT_HUB_STATE, [display])).toBeNull();
  });
});

describe("createHubStateStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hub-state-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes changes and reads them back", async () => {
    const file = path.join(dir, "hub-window.json");
    const logger = { warn: () => {} };
    const store = createHubStateStore({ file, minWidth: 960, minHeight: 640, logger });
    expect(await store.load()).toEqual(DEFAULT_HUB_STATE);
    store.update({ page: "insights" });
    store.update({ width: 1200, height: 800 });
    await store.flush();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      page: "insights",
      width: 1200,
    });
    const again = createHubStateStore({ file, minWidth: 960, minHeight: 640, logger });
    expect((await again.load()).page).toBe("insights");
  });
});
