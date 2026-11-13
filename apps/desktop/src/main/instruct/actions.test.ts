import { describe, expect, it } from "vitest";
import { asksForAction } from "./actions";

describe("asksForAction", () => {
  it.each([
    "Send this to Sam",
    "send Sam a note saying I'm late",
    "Email the team that the build is fixed",
    "Schedule a meeting with Priya on Friday",
    "remind me to call the bank tomorrow",
    "Write a reply and send it",
    "text mum that I'm on my way",
    "set a reminder for 5 pm",
    "could you book a table for two",
    "draft the invite and then schedule it for Monday",
  ])("knows %j asks to act", (instruction) => {
    expect(asksForAction(instruction)).toBe(true);
  });

  it.each([
    "draft a reply saying I can do Thursday",
    "Write an email to Sam about the launch",
    "reply that I agree, keep it short",
    "add a line about the deadline",
    "make it more formal",
    "summarise this in three bullet points",
    "write a message asking to reschedule",
    "create a short bio for my profile",
  ])("knows %j is drafting", (instruction) => {
    expect(asksForAction(instruction)).toBe(false);
  });
});
