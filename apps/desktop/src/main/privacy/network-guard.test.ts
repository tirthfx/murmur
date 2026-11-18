import { describe, expect, it } from "vitest";
import { createNetworkGuard, NetworkRefusedError } from "./network-guard";

describe("network guard (HB-52)", () => {
  it("refuses a model download while strict local mode is on", () => {
    let strict = true;
    const guard = createNetworkGuard({ strict: () => strict, logger: { warn: () => {} } });
    expect(() => guard.check("speech model download")).toThrow(NetworkRefusedError);
    strict = false;
    expect(() => guard.check("speech model download")).not.toThrow();
  });

  it("lets only local pages load in strict mode", () => {
    const guard = createNetworkGuard({ strict: () => true });
    expect(guard.allowsUrl("https://example.com/model.bin")).toBe(false);
    expect(guard.allowsUrl("http://localhost:5173/index.html")).toBe(true);
    expect(guard.allowsUrl("file:///Applications/Murmur.app/index.html")).toBe(true);
    expect(createNetworkGuard({ strict: () => false }).allowsUrl("https://example.com")).toBe(true);
  });
});
