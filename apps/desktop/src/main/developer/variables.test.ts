import { describe, expect, it } from "vitest";
import { applyReplacements } from "../dictionary/apply";
import { identifierWords, identifiersIn, variableReplacements } from "./variables";

describe("variable recognition", () => {
  it("splits identifiers in the four cases into words", () => {
    expect(identifierWords("fetchUserProfile")).toEqual(["fetch", "user", "profile"]);
    expect(identifierWords("HttpClient")).toEqual(["http", "client"]);
    expect(identifierWords("user_id")).toEqual(["user", "id"]);
    expect(identifierWords("MAX_RETRIES")).toEqual(["max", "retries"]);
    expect(identifierWords("main-page")).toEqual(["main", "page"]);
    expect(identifierWords("profile")).toBeNull();
    expect(identifierWords("HTTP")).toBeNull();
  });

  it("finds identifiers on screen, each once, at most the limit", () => {
    const code =
      "const profile = await fetchUserProfile(user_id);\nfetchUserProfile(x); HttpClient";
    expect(identifiersIn(code)).toEqual(["fetchUserProfile", "user_id", "HttpClient"]);
    expect(identifiersIn(code, 1)).toEqual(["fetchUserProfile"]);
  });

  it("writes spoken names as the identifier on screen", () => {
    const rules = variableReplacements(["fetchUserProfile", "fetch_user_profile", "user_id"]);
    expect(applyReplacements("call fetch user profile with the user id", rules).text).toBe(
      "call fetchUserProfile with the user_id",
    );
  });
});
