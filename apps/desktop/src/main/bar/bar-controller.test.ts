import { describe, expect, it } from "vitest";
import type { BarView } from "@murmur/shared";
import { FakeClock } from "../helper/fakes";
import { createBarController, type BarPort } from "./bar-controller";

function setup() {
  const views: BarView[] = [];
  const levels: number[] = [];
  const port: BarPort = { render: (view) => views.push(view), level: (db) => levels.push(db) };
  const clock = new FakeClock();
  return { views, levels, clock, bar: createBarController(port, clock) };
}

describe("bar controller", () => {
  it("pushes each change and nothing for events that do not apply", () => {
    const { bar, views } = setup();
    bar.dispatch({ type: "stop" });
    bar.dispatch({ type: "start", at: 10 });
    bar.dispatch({ type: "stop" });
    expect(views.map((view) => view.state)).toEqual(["listening", "processing"]);
  });

  it("shows done for 800 ms, then goes back to idle", async () => {
    const { bar, views, clock } = setup();
    bar.dispatch({ type: "start", at: 0 });
    bar.dispatch({ type: "stop" });
    bar.dispatch({ type: "transcribed", words: 12 });
    expect(bar.getView()).toMatchObject({ state: "done", words: 12 });
    await clock.advance(799);
    expect(bar.getView().state).toBe("done");
    await clock.advance(1);
    expect(views.at(-1)?.state).toBe("idle");
  });

  it("shows cancelled for 600 ms", async () => {
    const { bar, clock } = setup();
    bar.dispatch({ type: "start", at: 0 });
    bar.dispatch({ type: "cancel" });
    await clock.advance(600);
    expect(bar.getView().state).toBe("idle");
  });

  it("drops the old timer when a new state starts", async () => {
    const { bar, clock } = setup();
    bar.dispatch({ type: "start", at: 0 });
    bar.dispatch({ type: "stop" });
    bar.dispatch({ type: "transcribed", words: 1 });
    bar.dispatch({ type: "start", at: 500 });
    await clock.advance(2000);
    expect(bar.getView()).toMatchObject({ state: "listening", startedAt: 500 });
    expect(clock.pendingTimers).toBe(0);
  });

  it("passes levels through only while recording", () => {
    const { bar, levels } = setup();
    bar.level(-30);
    bar.dispatch({ type: "start", at: 0 });
    bar.level(-20);
    bar.dispatch({ type: "stop" });
    bar.level(-10);
    expect(levels).toEqual([-20]);
  });

  it("turns a click into retry in error only", () => {
    const { bar } = setup();
    expect(bar.click()).toBeNull();
    bar.dispatch({ type: "start", at: 0 });
    expect(bar.click()).toBeNull();
    bar.dispatch({ type: "stop" });
    bar.dispatch({ type: "failed" });
    expect(bar.click()).toBe("retry");
  });
});
