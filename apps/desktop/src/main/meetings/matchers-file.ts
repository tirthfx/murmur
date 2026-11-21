import {
  meetingMatchersSchema,
  DEFAULT_MEETING_MATCHERS,
  type MeetingMatcher,
} from "@murmur/shared";
import type { Logger } from "../helper/types";

/**
 * The matchers for detection (NT-01). A file `meeting-matchers.json` in the profile folder,
 * a list of matchers, replaces the built-in ones, so a call app can be added or fixed without
 * a new release. A missing file means the built-in list; a file that is not valid is ignored
 * and said so in the log, so a typo cannot turn detection off.
 */
export function loadMeetingMatchers(read: () => string | null, logger: Logger): MeetingMatcher[] {
  let text: string | null;
  try {
    text = read();
  } catch {
    return DEFAULT_MEETING_MATCHERS;
  }
  if (text === null) return DEFAULT_MEETING_MATCHERS;
  try {
    const parsed = meetingMatchersSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
    logger.warn(`meeting-matchers.json ignored: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  } catch {
    logger.warn("meeting-matchers.json ignored: not valid JSON");
  }
  return DEFAULT_MEETING_MATCHERS;
}
