import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { ignoreClosedPipes } from "./closed-pipes";

const failed = (code: string) => Object.assign(new Error(`write ${code}`), { code });

describe("a terminal that went away", () => {
  it("ignores a broken pipe on every stream, and raises other errors", () => {
    const streams = [new EventEmitter(), new EventEmitter()];
    ignoreClosedPipes(streams);
    for (const stream of streams) {
      expect(() => stream.emit("error", failed("EPIPE"))).not.toThrow();
      expect(() => stream.emit("error", failed("ENOSPC"))).toThrow("write ENOSPC");
    }
  });
});
