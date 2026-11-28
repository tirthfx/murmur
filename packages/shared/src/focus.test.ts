import { describe, expect, it } from "vitest";
import {
  focusAppInputSchema,
  focusTimeLeft,
  frontAppPayloadSchema,
  parseSiteEntry,
  siteMatches,
} from "./focus";

describe("Focus sites", () => {
  it("stores a typed site as domain and path", () => {
    expect(parseSiteEntry("example.com")).toEqual({
      domain: "example.com",
      path: null,
      value: "example.com",
    });
    expect(parseSiteEntry("https://WWW.YouTube.com/Shorts/?x=1#top")).toEqual({
      domain: "youtube.com",
      path: "/shorts",
      value: "youtube.com/shorts",
    });
    expect(parseSiteEntry("news.example.co.uk:8080/")).toMatchObject({
      domain: "news.example.co.uk",
      path: null,
    });
    expect(parseSiteEntry("localhost")).toBeNull();
    expect(parseSiteEntry("not a site")).toBeNull();
    expect(parseSiteEntry("")).toBeNull();
  });

  it("matches the domain and its subdomains, and paths under a prefix", () => {
    expect(siteMatches("example.com", { host: "example.com", path: "/" })).toBe(true);
    expect(siteMatches("example.com", { host: "www.example.com", path: "/a" })).toBe(true);
    expect(siteMatches("example.com", { host: "m.news.example.com", path: "/" })).toBe(true);
    expect(siteMatches("example.com", { host: "notexample.com", path: "/" })).toBe(false);
    expect(siteMatches("example.com", { host: "example.com.evil.net", path: "/" })).toBe(false);
    expect(
      siteMatches("youtube.com/shorts", { host: "www.youtube.com", path: "/shorts/abc" }),
    ).toBe(true);
    expect(siteMatches("youtube.com/shorts", { host: "youtube.com", path: "/Shorts" })).toBe(true);
    expect(siteMatches("youtube.com/shorts", { host: "youtube.com", path: "/shortsfeed" })).toBe(
      false,
    );
    expect(siteMatches("youtube.com/shorts", { host: "youtube.com", path: "/watch" })).toBe(false);
  });

  it("accepts the front app event with and without a site", () => {
    expect(
      frontAppPayloadSchema.safeParse({ bundleId: "com.apple.Notes", name: "Notes", pid: 1 })
        .success,
    ).toBe(true);
    expect(
      frontAppPayloadSchema.safeParse({
        bundleId: "com.apple.Safari",
        name: "Safari",
        pid: 2,
        site: { host: "example.com", path: "/" },
        siteStatus: "ok",
      }).success,
    ).toBe(true);
  });

  it("shows time left as m:ss or h:mm:ss", () => {
    expect(focusTimeLeft(65_000, 0)).toBe("1:05");
    expect(focusTimeLeft(90 * 60_000, 0)).toBe("1:30:00");
    expect(focusTimeLeft(0, 5000)).toBe("0:00");
  });
});

describe("Blocked app ids", () => {
  const accepts = (bundleId: string) =>
    focusAppInputSchema.safeParse({ bundleId, label: "App" }).success;

  it("takes a bundle id", () => {
    expect(accepts("com.example.App")).toBe(true);
  });

  it("refuses paths and plain words", () => {
    for (const id of ["Safari", "/Applications/App.app", "com.example.", "a|b.c"]) {
      expect(accepts(id), id).toBe(false);
    }
  });
});
