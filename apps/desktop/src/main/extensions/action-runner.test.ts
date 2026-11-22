import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXTENSIONS_SETTINGS,
  EXTENSION_ACTIONS,
  type ConnectorAccount,
  type ExtensionsSettings,
} from "@murmur/shared";
import { createActionRunner, fromUserClick, type ActionExecutor } from "./action-runner";

const account = (
  connector: string,
  status: ConnectorAccount["status"] = "connected",
): ConnectorAccount => ({
  id: `a-${connector}`,
  connector,
  email: `me@${connector}.test`,
  scopes: [],
  status,
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
});

const draftInput = {
  source: { kind: "task", id: "t1" },
  accountId: "a-gmail",
  to: "dana@example.com",
  subject: "Hello",
  body: "Text",
};

function setup(
  options: {
    settings?: Partial<ExtensionsSettings>;
    on?: ("draft_email" | "create_event" | "post_to_slack")[];
    accounts?: ConnectorAccount[];
    available?: boolean;
    reason?: string | null;
  } = {},
) {
  const run = vi.fn(async () => ({ ok: true }));
  const executor = (): ActionExecutor => ({
    state: () => ({ available: options.available ?? true, reason: options.reason ?? null }),
    run,
  });
  const actions = { draft_email: false, create_event: false, post_to_slack: false };
  for (const id of options.on ?? []) actions[id] = true;
  const runner = createActionRunner({
    settings: () => ({ ...DEFAULT_EXTENSIONS_SETTINGS, actions, ...options.settings }),
    accounts: () => options.accounts ?? [account("gmail"), account("googleCalendar")],
    executors: { draft_email: executor(), create_event: executor(), post_to_slack: executor() },
  });
  return { runner, run };
}

describe("extension actions (CN-12)", () => {
  it("has a fixed set of built-in actions, each with its own connector and a required confirmation", () => {
    expect(EXTENSION_ACTIONS.map((a) => a.id)).toEqual([
      "draft_email",
      "create_event",
      "post_to_slack",
    ]);
    for (const action of EXTENSION_ACTIONS) {
      expect(action.requiresConfirm).toBe(true);
      expect(action.connectors.length).toBeGreaterThan(0);
    }
  });

  describe("state", () => {
    it("is off until the owner turns an action on, and then it is hidden where it would be used", () => {
      const t = setup();
      expect(t.runner.stateOf("draft_email")).toEqual({
        state: "off",
        reason: "Turn on “Draft email” on the Extensions page.",
        hidden: true,
      });
      expect(t.runner.visible()).toEqual([]);
    });

    it("is hidden entirely when extensions are off", () => {
      const t = setup({ settings: { enabled: false }, on: ["draft_email"] });
      expect(t.runner.stateOf("draft_email")).toMatchObject({ state: "off", hidden: true });
      expect(t.runner.visible()).toEqual([]);
    });

    it("hides an action whose connector is disconnected, so it is left out of task automations", () => {
      const t = setup({
        on: ["draft_email", "create_event"],
        accounts: [account("googleCalendar")],
      });
      expect(t.runner.stateOf("draft_email")).toMatchObject({
        state: "not-connected",
        hidden: true,
      });
      expect(t.runner.stateOf("create_event")).toMatchObject({ state: "ready", hidden: false });
      expect(t.runner.visible()).toEqual(["create_event"]);
    });

    it("shows an action as blocked, with the reason, when its account needs attention or lacks a permission", () => {
      const needs = setup({ on: ["draft_email"], accounts: [account("gmail", "needs_attention")] });
      expect(needs.runner.stateOf("draft_email")).toEqual({
        state: "blocked",
        reason: "Its account needs to be connected again.",
        hidden: false,
      });
      const permission = setup({
        on: ["draft_email"],
        available: false,
        reason: "Give the permission.",
      });
      expect(permission.runner.stateOf("draft_email")).toEqual({
        state: "blocked",
        reason: "Give the permission.",
        hidden: false,
      });
      expect(permission.runner.visible()).toEqual(["draft_email"]);
    });

    it("is ready when it is on, connected and permitted", () => {
      const t = setup({ on: ["draft_email"] });
      expect(t.runner.stateOf("draft_email")).toEqual({
        state: "ready",
        reason: null,
        hidden: false,
      });
    });
  });

  describe("the page", () => {
    it("lists every action with its state and the accounts that can run it, and what is planned", () => {
      const t = setup({ on: ["draft_email"] });
      const view = t.runner.view();
      expect(view.enabled).toBe(true);
      expect(view.actions.map((a) => [a.id, a.enabled, a.status.state, a.accounts])).toEqual([
        ["draft_email", true, "ready", ["me@gmail.test"]],
        ["create_event", false, "off", ["me@googleCalendar.test"]],
        ["post_to_slack", false, "off", []],
      ]);
      expect(view.planned.map((p) => p.name)).toEqual(["Create a Linear issue"]);
    });
  });

  describe("running", () => {
    it("runs an action once for a click, with the input checked", async () => {
      const t = setup({ on: ["draft_email"] });
      const result = await t.runner.run("draft_email", draftInput, fromUserClick());
      expect(result).toEqual({ ok: true, result: { ok: true } });
      expect(t.run).toHaveBeenCalledTimes(1);
      expect(t.run).toHaveBeenCalledWith(draftInput);
    });

    it("does not run without a click, whatever else is in the request", async () => {
      const t = setup({ on: ["draft_email"] });
      for (const fake of [
        undefined,
        null,
        {},
        { kind: "user-click" },
        { confirmed: true },
        "click",
      ]) {
        const result = await t.runner.run("draft_email", draftInput, fake as never);
        expect(result).toEqual({ ok: false, message: "An action needs a click to run." });
      }
      expect(t.run).not.toHaveBeenCalled();
    });

    it("does not run an action that is off, disconnected or blocked, even for a click", async () => {
      for (const options of [
        {},
        { on: ["draft_email" as const], accounts: [account("googleCalendar")] },
        { on: ["draft_email" as const], available: false, reason: "Not permitted." },
        { on: ["draft_email" as const], settings: { enabled: false } },
      ]) {
        const t = setup(options);
        expect((await t.runner.run("draft_email", draftInput, fromUserClick())).ok).toBe(false);
        expect(t.run).not.toHaveBeenCalled();
      }
    });

    it("sends a Slack message only by the preview's token, never by text", async () => {
      const t = setup({
        on: ["post_to_slack"],
        accounts: [account("slack")],
      });
      expect(await t.runner.run("post_to_slack", { token: "tok-1" }, fromUserClick())).toEqual({
        ok: true,
        result: { ok: true },
      });
      expect(t.run).toHaveBeenCalledWith({ token: "tok-1" });
      for (const input of [
        { text: "Hi", channelId: "C1" },
        { token: "tok-1", text: "changed" },
        {},
      ]) {
        expect((await t.runner.run("post_to_slack", input, fromUserClick())).ok).toBe(false);
      }
      expect(t.run).toHaveBeenCalledTimes(1);
    });

    it("refuses input the action would not accept", async () => {
      const t = setup({ on: ["draft_email"] });
      expect(
        await t.runner.run("draft_email", { ...draftInput, subject: "" }, fromUserClick()),
      ).toEqual({
        ok: false,
        message: "Draft email was not given what it needs.",
      });
      expect(
        await t.runner.run("draft_email", { ...draftInput, send: true }, fromUserClick()),
      ).toMatchObject({ ok: false });
      expect(t.run).not.toHaveBeenCalled();
    });
  });

  describe("what a model writes (no action without a click)", () => {
    it("becomes a proposal that nothing runs, even when it says it is confirmed", () => {
      const t = setup({ on: ["draft_email"] });
      const proposal = t.runner.parseProposal(
        `Sure! {"action":"draft_email","confirmed":true,"approved":"yes","input":${JSON.stringify(draftInput)}}`,
      );
      expect(proposal).toEqual({ actionId: "draft_email", input: draftInput });
      expect(t.run).not.toHaveBeenCalled();
    });

    it("is dropped when it names no action, an unknown one, bad input, or is not JSON", () => {
      const t = setup({ on: ["draft_email"] });
      for (const text of [
        "no json here",
        "{broken",
        '{"input":{}}',
        '{"action":"send_email","input":{}}',
        `{"action":"draft_email","input":{"to":"x"}}`,
        '{"action":"draft_email"}',
        "[1,2]",
      ])
        expect(t.runner.parseProposal(text)).toBeNull();
      expect(t.run).not.toHaveBeenCalled();
    });
  });

  describe("tokens", () => {
    it("never reach an action: the runner holds no connector service, and an action is called with its input alone", async () => {
      const t = setup({ on: ["draft_email"] });
      expect(Object.keys(t.runner).sort()).toEqual([
        "parseProposal",
        "run",
        "stateOf",
        "view",
        "visible",
      ]);
      await t.runner.run("draft_email", draftInput, fromUserClick());
      expect(t.run.mock.calls[0]).toHaveLength(1);
      expect(JSON.stringify(t.runner.view())).not.toMatch(/token|secret/i);
    });
  });

  describe("who may make a click", () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sources(full);
        return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
      });

    it("is asked for only by the code that handles a click from the window", () => {
      const root = path.resolve(here, "../..");
      const users = sources(root)
        .filter((file) => /fromUserClick/.test(readFileSync(file, "utf8")))
        .map((file) => path.relative(root, file))
        .sort();
      expect(users).toEqual(["main/extensions/action-runner.ts", "main/main.ts"]);
    });
  });
});
