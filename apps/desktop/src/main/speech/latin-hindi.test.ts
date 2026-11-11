import { describe, expect, it } from "vitest";
import { hasDevanagari, toLatinHindi } from "./latin-hindi";

describe("Hindi in Latin letters", () => {
  it("writes common words the way people type them", () => {
    expect(toLatinHindi("नमस्ते")).toBe("namaste");
    expect(toLatinHindi("क्या")).toBe("kya");
    expect(toLatinHindi("आप")).toBe("aap");
    expect(toLatinHindi("ठीक है")).toBe("theek hai");
    expect(toLatinHindi("बहुत")).toBe("bahut");
    expect(toLatinHindi("मैं")).toBe("main");
    expect(toLatinHindi("नहीं")).toBe("nahin");
    expect(toLatinHindi("ज़रूर")).toBe("zaroor");
  });

  it("keeps English words and punctuation, and ends sentences with a full stop", () => {
    expect(toLatinHindi("कल meeting है।")).toBe("kal meeting hai.");
    expect(toLatinHindi("Send it, ठीक है?")).toBe("Send it, theek hai?");
  });

  it("leaves Latin text alone and converts digits", () => {
    expect(toLatinHindi("Already fine.")).toBe("Already fine.");
    expect(hasDevanagari("Already fine.")).toBe(false);
    expect(toLatinHindi("१० बजे")).toBe("10 baje");
  });
});
