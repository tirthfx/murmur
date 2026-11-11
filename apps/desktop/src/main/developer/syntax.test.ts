import { describe, expect, it } from "vitest";
import { applySyntax, codeTokens, developerFormat } from "./syntax";

describe("spoken syntax", () => {
  it("writes identifiers in the case asked for", () => {
    expect(applySyntax("camel case user id")).toBe("userId");
    expect(applySyntax("Camel case, user ID.")).toBe("userId.");
    expect(applySyntax("snake case user id")).toBe("user_id");
    expect(applySyntax("pascal case http client")).toBe("HttpClient");
    expect(applySyntax("kebab case main page")).toBe("main-page");
    expect(applySyntax("constant case max retries")).toBe("MAX_RETRIES");
    expect(applySyntax("camelcase user name")).toBe("userName");
    expect(applySyntax("set camel case user id equals five")).toBe("set userId = five");
    expect(applySyntax("rename snake case user name to camel case user name")).toBe(
      "rename user_name to userName",
    );
  });

  it("turns symbol names into symbols", () => {
    expect(applySyntax("dash dash help")).toBe("--help");
    expect(applySyntax("Dash, dash, help.")).toBe("--help.");
    expect(applySyntax("dash-dash help")).toBe("--help");
    expect(applySyntax("ls dash la")).toBe("ls -la");
    expect(applySyntax("rm dash f")).toBe("rm -f");
    expect(applySyntax("index dot ts")).toBe("index.ts");
    expect(applySyntax("src slash app slash main dot ts")).toBe("src/app/main.ts");
    expect(applySyntax("C colon back slash users")).toBe("C:\\users");
    expect(applySyntax("my underscore var")).toBe("my_var");
    expect(applySyntax("print open paren x close paren")).toBe("print(x)");
    expect(applySyntax("items open bracket zero close bracket")).toBe("items[zero]");
    expect(applySyntax("localhost colon 3000")).toBe("localhost:3000");
  });

  it("leaves text without spoken syntax exactly as it was", () => {
    expect(applySyntax("Fix the  login bug.\nThen deploy.")).toBe(
      "Fix the  login bug.\nThen deploy.",
    );
  });
});

describe("developer output", () => {
  it("keeps a single line as a command: no capital, no final full stop", () => {
    expect(developerFormat("Camel case user ID.")).toBe("userId");
    expect(developerFormat("Run dash dash help.")).toBe("run --help");
    expect(developerFormat("Run kubectl apply.")).toBe("run kubectl apply");
    expect(developerFormat("Why does this fail?")).toBe("why does this fail?");
  });

  it("keeps a term's own capital and the word I", () => {
    expect(developerFormat("React renders twice.", new Set(["React"]))).toBe("React renders twice");
    expect(developerFormat("I think it works.")).toBe("I think it works");
  });

  it("keeps prose: several sentences, several lines, or full stop said at the end", () => {
    expect(developerFormat("Fix the bug. Then deploy.")).toBe("Fix the bug. Then deploy.");
    expect(developerFormat("First line.\nSecond line.")).toBe("First line.\nSecond line.");
    expect(developerFormat("Update the readme full stop")).toBe("Update the readme.");
    expect(developerFormat("Update the readme, full stop.")).toBe("Update the readme.");
  });
});

describe("code tokens", () => {
  it("finds identifiers, flags and paths, not plain words", () => {
    expect(codeTokens("rename user_name to userName, then run --help on src/app.ts.")).toEqual([
      "user_name",
      "userName",
      "--help",
      "src/app.ts",
    ]);
    expect(codeTokens("Fix the login bug.")).toEqual([]);
  });
});
