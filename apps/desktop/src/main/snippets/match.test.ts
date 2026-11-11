import { describe, expect, it } from "vitest";
import type { Snippet } from "@murmur/shared";
import { assemble, findSnippets } from "./match";

const snippet = (trigger: string, plain: string, rich: Snippet["rich"] = null): Snippet => ({
  id: `id-${trigger}`,
  trigger,
  format: rich ? "rich_json" : "plain",
  plain,
  rich,
  useCount: 0,
  createdAt: 1,
  updatedAt: 1,
});

const address = snippet("my address", "12 Hill Road\nPune 411001\nIndia");
const sign = snippet("sign off", "Best, Tirth");

describe("finding snippets", () => {
  it("matches the whole dictation, whatever the case and punctuation", () => {
    expect(findSnippets("My address.", [address])).toEqual([{ kind: "snippet", snippet: address }]);
  });

  it("matches a whole sentence inside a dictation", () => {
    expect(findSnippets("Please send it here. My address. Thanks!", [address])).toEqual([
      { kind: "text", text: "Please send it here." },
      { kind: "snippet", snippet: address },
      { kind: "text", text: "Thanks!" },
    ]);
  });

  it("leaves a trigger inside a longer sentence alone", () => {
    expect(findSnippets("I changed my address last week.", [address])).toBeNull();
    expect(findSnippets("Hello there.", [])).toBeNull();
  });
});

describe("putting the pieces together", () => {
  it("joins a one-line body into the flow and puts a multi-line body on its own lines", () => {
    expect(
      assemble([
        { kind: "text", text: "See you soon." },
        { kind: "snippet", snippet: sign },
      ]),
    ).toEqual({ text: "See you soon. Best, Tirth", html: null });
    expect(
      assemble([
        { kind: "text", text: "Send it to:" },
        { kind: "snippet", snippet: address },
      ]).text,
    ).toBe("Send it to:\n12 Hill Road\nPune 411001\nIndia");
  });

  it("gives HTML beside the plain text when a body is rich", () => {
    const bold = snippet("bold hello", "Hello", {
      blocks: [{ type: "paragraph", inlines: [{ text: "Hello", bold: true }] }],
    });
    expect(
      assemble([
        { kind: "text", text: "Hi & bye" },
        { kind: "snippet", snippet: bold },
      ]),
    ).toEqual({ text: "Hi & bye\nHello", html: "<p>Hi &amp; bye</p><p><b>Hello</b></p>" });
  });
});
