import { describe, expect, it } from "vitest";
import { CSP_PLACEHOLDER, buildCsp, injectCspMeta } from "./csp";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("buildCsp", () => {
  it("never allows eval, in either mode", () => {
    expect(buildCsp("production")).not.toContain("unsafe-eval");
    expect(buildCsp("development")).not.toContain("unsafe-eval");
  });

  describe("production", () => {
    const policy = directives(buildCsp("production"));

    it("blocks inline scripts and allows only bundled scripts", () => {
      expect(policy.get("script-src")).toEqual(["'self'"]);
    });

    it("allows only bundled styles", () => {
      expect(policy.get("style-src")).toEqual(["'self'"]);
    });

    it("contains no remote origin, wildcard or localhost anywhere", () => {
      const text = buildCsp("production");
      expect(text).not.toMatch(/https?:/);
      expect(text).not.toMatch(/wss?:/);
      expect(text).not.toContain("*");
      expect(text).not.toContain("localhost");
    });

    it("serves fonts and images only from the bundle", () => {
      expect(policy.get("font-src")).toEqual(["'self'"]);
      expect(policy.get("img-src")).toEqual(["'self'", "data:"]);
    });

    it("blocks network connections, plugins, frames, base and forms", () => {
      expect(policy.get("default-src")).toEqual(["'none'"]);
      expect(policy.get("connect-src")).toEqual(["'none'"]);
      expect(policy.get("object-src")).toEqual(["'none'"]);
      expect(policy.get("frame-src")).toEqual(["'none'"]);
      expect(policy.get("base-uri")).toEqual(["'none'"]);
      expect(policy.get("form-action")).toEqual(["'none'"]);
    });
  });

  describe("development", () => {
    const policy = directives(buildCsp("development"));

    it("allows the inline script and style Vite needs", () => {
      expect(policy.get("script-src")).toContain("'unsafe-inline'");
      expect(policy.get("style-src")).toContain("'unsafe-inline'");
    });

    it("allows loopback HTTP and WebSocket connections only", () => {
      const sources = policy.get("connect-src") ?? [];
      expect(sources).toContain("ws://localhost:*");
      for (const source of sources) {
        expect(source).toMatch(/^('self'|(https?|wss?):\/\/(localhost|127\.0\.0\.1):\*)$/);
      }
    });

    it("does not allow remote scripts", () => {
      const scripts = policy.get("script-src") ?? [];
      expect(scripts.filter((source) => /^(https?|wss?):/.test(source))).toEqual([]);
    });
  });

  it("differs between modes", () => {
    expect(buildCsp("development")).not.toBe(buildCsp("production"));
  });
});

describe("injectCspMeta", () => {
  it("replaces the placeholder with a meta tag carrying the policy", () => {
    const html = `<head>${CSP_PLACEHOLDER}</head>`;
    const result = injectCspMeta(html, "default-src 'none'");
    expect(result).toBe(
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'" /></head>`,
    );
  });

  it("throws when the placeholder is missing", () => {
    expect(() => injectCspMeta("<head></head>", "default-src 'none'")).toThrow();
  });
});
