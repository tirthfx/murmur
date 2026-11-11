import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { resolveCategory } from "./app-categories";
import { createStyleStore } from "./style-store";

describe("app categories", () => {
  const none = new Map();
  it("uses the default table, then the browser title, then Other", () => {
    expect(resolveCategory({ bundleId: "com.apple.mail", windowTitle: null }, none)).toEqual({
      category: "email",
      source: "default",
    });
    expect(
      resolveCategory({ bundleId: "net.whatsapp.WhatsApp", windowTitle: null }, none).category,
    ).toBe("personal");
    expect(
      resolveCategory({ bundleId: "com.google.Chrome", windowTitle: "Inbox (3) - Gmail" }, none),
    ).toEqual({ category: "email", source: "title" });
    expect(
      resolveCategory({ bundleId: "com.google.Chrome", windowTitle: "Recipes" }, none).category,
    ).toBe("other");
    expect(resolveCategory({ bundleId: null, windowTitle: null }, none).category).toBe("other");
  });

  it("lets the owner's choice win", () => {
    const overrides = new Map([["com.apple.mail", "personal" as const]]);
    expect(resolveCategory({ bundleId: "com.apple.mail", windowTitle: null }, overrides)).toEqual({
      category: "personal",
      source: "user",
    });
  });
});

describe("style store", () => {
  it("starts with the four built-in styles", () => {
    const store = createStyleStore(openDatabase(":memory:"));
    expect(store.view().styles.map((style) => [style.category, style.preset])).toEqual([
      ["personal", "no-caps-less"],
      ["work", "caps"],
      ["email", "formal"],
      ["other", "caps"],
    ]);
  });

  it("changes a style and resolves apps to it, overrides surviving a restart", () => {
    const db = openDatabase(":memory:");
    const store = createStyleStore(db, () => 9);
    store.update({ category: "work", preset: "exclaim", instructions: "  Use British spelling. " });
    store.setOverride({ bundleId: "com.example.chat", appName: "Chat", category: "work" });
    const again = createStyleStore(db);
    const resolved = again.resolve({ bundleId: "com.example.chat", windowTitle: null });
    expect(resolved).toMatchObject({
      category: "work",
      source: "user",
      style: { id: "style-work", preset: "exclaim", instructions: "Use British spelling." },
    });
    expect(again.view().overrides).toEqual([
      { bundleId: "com.example.chat", appName: "Chat", category: "work" },
    ]);
    again.clearOverride("com.example.chat");
    expect(again.resolve({ bundleId: "com.example.chat", windowTitle: null }).category).toBe(
      "other",
    );
  });

  it("uses the Other style for developer apps and lists recent apps with their category", () => {
    const db = openDatabase(":memory:");
    const store = createStyleStore(db);
    expect(store.resolve({ bundleId: "com.apple.Terminal", windowTitle: null })).toMatchObject({
      category: "developer",
      style: { category: "other" },
    });
    db.prepare(
      `INSERT INTO history (id, created_at, source, duration_ms, word_count, cleanup_status,
        insert_status, app_bundle_id, app_name) VALUES ('h1', 1, 'hold', 1, 1, 'applied', 'inserted', 'com.apple.mail', 'Mail')`,
    ).run();
    expect(store.view().recentApps).toEqual([
      { bundleId: "com.apple.mail", appName: "Mail", category: "email", source: "default" },
    ]);
  });
});
