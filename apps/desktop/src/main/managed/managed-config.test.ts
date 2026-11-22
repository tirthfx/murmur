import { describe, expect, it } from "vitest";
import { loadManagedConfig } from "./managed-config";

const load = (text: string | null | Error) => {
  const lines: string[] = [];
  const state = loadManagedConfig({
    read: () => {
      if (text instanceof Error) throw text;
      return text;
    },
    log: (line) => lines.push(line),
  });
  return { state, lines };
};

describe("the managed configuration file", () => {
  it("means nothing is managed when there is no file", () => {
    expect(load(null)).toEqual({ state: { config: null, invalid: null }, lines: [] });
  });

  it("is read when it follows the contract", () => {
    const { state } = load(
      JSON.stringify({
        version: 1,
        serverUrl: "https://team.example.com",
        policy: { "features.mcp": false, blockedDomains: ["example.com"] },
        updates: { policy: "off" },
      }),
    );
    expect(state.invalid).toBeNull();
    expect(state.config).toMatchObject({
      serverUrl: "https://team.example.com",
      policy: { "features.mcp": false, blockedDomains: ["example.com"] },
      updates: { policy: "off" },
    });
  });

  it("is ignored and logged when it is not JSON, has the wrong version, an unknown key or a bad value", () => {
    for (const text of [
      "{not json",
      JSON.stringify({ version: 2 }),
      JSON.stringify({ version: 1, extra: true }),
      JSON.stringify({ version: 1, updates: { policy: "sometimes" } }),
      JSON.stringify({ version: 1, policy: { "features.mcp": "no" } }),
      JSON.stringify({ version: 1, policy: { "features.teleport": true } }),
      JSON.stringify({ version: 1, serverUrl: "ftp://x.example.com" }),
      JSON.stringify({
        version: 1,
        updates: { policy: "automatic", feedUrl: "http://plain.example.com" },
      }),
      "[]",
    ]) {
      const { state, lines } = load(text);
      expect(state.config, text).toBeNull();
      expect(state.invalid, text).toContain("not valid");
      expect(lines, text).toHaveLength(1);
      expect(lines[0], text).toContain("ignored");
    }
  });

  it("is ignored when it cannot be read at all", () => {
    const { state, lines } = load(new Error("EACCES"));
    expect(state).toEqual({
      config: null,
      invalid: "The managed configuration could not be read.",
    });
    expect(lines).toHaveLength(1);
  });
});
