import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createMeetingsStore } from "./meetings-store";

function setup() {
  const store = createMeetingsStore(openDatabase(":memory:"));
  store.create({
    id: "m-1",
    title: "Meeting, 21 Nov 10:00",
    startedAt: 1,
    source: "ad_hoc",
    folder: "/profile/meetings/m-1",
  });
  return store;
}

describe("meetings store titles and consent", () => {
  it("lets a summary set the title until the owner renames it", () => {
    const store = setup();
    expect(store.setGeneratedTitle("m-1", "Roadmap review")).toBe(true);
    expect(store.get("m-1")?.title).toBe("Roadmap review");
    store.rename("m-1", "  My own name ");
    expect(store.get("m-1")?.title).toBe("My own name");
    // A new summary does not take the name back.
    expect(store.setGeneratedTitle("m-1", "Budget talk")).toBe(false);
    expect(store.get("m-1")?.title).toBe("My own name");
  });

  it("ignores an empty generated title and an empty rename", () => {
    const store = setup();
    expect(store.setGeneratedTitle("m-1", "   ")).toBe(false);
    store.rename("m-1", " ");
    expect(store.get("m-1")?.title).toBe("Meeting, 21 Nov 10:00");
    expect(store.setGeneratedTitle("m-1", "Later")).toBe(true);
  });

  it("stores the notice acknowledgement per meeting", () => {
    const store = setup();
    expect(store.consentAcknowledgedAt("m-1")).toBeNull();
    store.acknowledgeConsent("m-1", 500);
    expect(store.consentAcknowledgedAt("m-1")).toBe(500);
    expect(store.consentAcknowledgedAt("missing")).toBeNull();
  });
});

describe("meetings started from a calendar event (NT-02)", () => {
  it("keeps the event id and who was invited, and has none for any other meeting", () => {
    const db = openDatabase(":memory:");
    const store = createMeetingsStore(db);
    const plain = store.create({
      id: "m-1",
      title: "Ad hoc",
      startedAt: 1,
      source: "ad_hoc",
      folder: "/m/1",
    });
    expect(plain).toMatchObject({ calendarEventId: null, attendees: [] });
    const fromEvent = store.create({
      id: "m-2",
      title: "Design sync",
      startedAt: 2,
      source: "calendar",
      folder: "/m/2",
      calendarEventId: "evt-9",
      attendees: [
        { name: "Dana", email: "dana@example.com" },
        { name: null, email: "sam@example.com" },
      ],
    });
    expect(fromEvent).toMatchObject({
      source: "calendar",
      calendarEventId: "evt-9",
      attendees: [
        { name: "Dana", email: "dana@example.com" },
        { name: null, email: "sam@example.com" },
      ],
    });
    expect(store.get("m-2")).toEqual(fromEvent);
  });
});
