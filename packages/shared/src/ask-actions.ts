import { z } from "zod";
import type { CalendarEventProposal } from "./calendar";
import type { EmailDraftProposal } from "./gmail";

/**
 * Connector actions proposed from Ask (CN-13), behind the experimental option. A request such as
 * "draft a follow-up to Priya about the timeline" becomes one proposal with its form filled in as
 * far as it can be; the owner reads it, changes it and confirms it with a click, exactly as for a
 * task. A question that only asks for information never becomes a proposal.
 */

export const askActionRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(2000),
  /** The meeting Ask is about, when it is about one. */
  meetingId: z.string().min(1).max(64).nullable(),
});
export type AskActionRequest = z.infer<typeof askActionRequestSchema>;

/** One proposed action, with what the owner will see and edit. Nothing has been sent or created. */
export type AskActionProposal =
  | {
      action: "draft_email";
      /** One line: what is proposed. */
      line: string;
      /** Who it is for was not found among the people Murmur knows, so the owner chooses (or types) the address. */
      note: string | null;
      form: EmailDraftProposal;
    }
  | {
      action: "create_event";
      line: string;
      note: string | null;
      form: CalendarEventProposal;
    }
  | {
      action: "post_to_slack";
      line: string;
      note: string | null;
      /** The message to start from; the channels are listed when the owner goes on to the preview. */
      text: string;
    };

export type AskActionResult =
  { ok: true; proposal: AskActionProposal | null } | { ok: false; message: string };

/** The id used for an action that started in Ask: it has no task or meeting behind it. */
export const askSourceId = () => `ask-${Date.now().toString(36)}`;
