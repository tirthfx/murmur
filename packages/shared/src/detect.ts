import { z } from "zod";

/**
 * Meeting detection (NT-01). A matcher says how to tell that one call app has a call going:
 * a native app by its bundle id and a word in a window's title, a web app by the host (and
 * optionally the path or a word in the title) of the tab that is showing in a browser window.
 * A tab in the background is not shown, so it never matches. Matchers are data: the defaults
 * are below, and a file in the profile folder can replace them without a new release.
 */

const regexText = z
  .string()
  .max(200)
  .refine((text) => {
    try {
      new RegExp(text);
      return true;
    } catch {
      return false;
    }
  }, "not a valid pattern");

const words = z.array(z.string().trim().min(1).max(100)).min(1).max(8);

export const meetingMatcherSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    /** Shown to the owner: "Zoom". */
    name: z.string().trim().min(1).max(60),
    /** A native app. A window title containing any of `titles` (any case) means a call. */
    native: z
      .strictObject({ bundleIds: z.array(z.string().min(1).max(255)).min(1).max(8), titles: words })
      .optional(),
    /** A web app. The visible tab's host must match; `path` and `titles` narrow it further. */
    web: z
      .strictObject({
        hosts: z
          .array(
            z
              .string()
              .trim()
              .toLowerCase()
              .regex(/^[a-z0-9.-]{1,253}$/),
          )
          .min(1)
          .max(8),
        path: regexText.optional(),
        titles: words.optional(),
      })
      .optional(),
  })
  .refine((matcher) => matcher.native !== undefined || matcher.web !== undefined, {
    message: "a matcher needs `native` or `web`",
  });
export type MeetingMatcher = z.infer<typeof meetingMatcherSchema>;

export const meetingMatchersSchema = z.array(meetingMatcherSchema).max(20);

/** Zoom, Google Meet and Microsoft Teams. The Teams title words are a best effort. */
export const DEFAULT_MEETING_MATCHERS: MeetingMatcher[] = [
  {
    id: "zoom",
    name: "Zoom",
    native: { bundleIds: ["us.zoom.xos"], titles: ["Zoom Meeting"] },
  },
  {
    id: "meet",
    name: "Google Meet",
    web: { hosts: ["meet.google.com"], path: "^/[a-z]{3}-[a-z]{4}-[a-z]{3}(/|$)" },
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    native: {
      bundleIds: ["com.microsoft.teams2", "com.microsoft.teams"],
      titles: ["Meeting with", "Meeting in", "Call with"],
    },
    web: {
      hosts: ["teams.microsoft.com", "teams.live.com"],
      titles: ["Meeting with", "Meeting in", "Call with"],
    },
  },
];

/** `detect.subscribe`: watch for calls with these matchers, or stop. */
export const detectSubscribePayloadSchema = z.object({
  enabled: z.boolean(),
  matchers: meetingMatchersSchema,
});
export type DetectSubscribeInput = z.infer<typeof detectSubscribePayloadSchema>;
export const detectSubscribeResultSchema = z.object({ watching: z.boolean() });

/** `detect.event`: a call started or ended for a matcher. Never carries a title or address. */
export const detectEventPayloadSchema = z.object({
  matcherId: z.string().min(1).max(32),
  active: z.boolean(),
});
export type DetectEvent = z.infer<typeof detectEventPayloadSchema>;

/** `notetaker.detect` (NT-01). */
export const detectSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  /** Start recording without asking. */
  autoRecord: z.boolean(),
  /** One switch per matcher id; a missing id counts as on. */
  apps: z.record(z.string(), z.boolean()),
  /** Matcher ids the owner chose "Never for this app" for. */
  neverApps: z.array(z.string().max(32)).max(50),
});
export type DetectSettings = z.infer<typeof detectSettingsSchema>;

export const DEFAULT_DETECT: DetectSettings = {
  enabled: true,
  autoRecord: false,
  apps: { zoom: true, meet: true, teams: true },
  neverApps: [],
};
