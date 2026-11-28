import {
  CALENDAR_WRITE_SCOPES,
  CONNECTOR_CATALOGUE,
  connectorChoice,
  hasScope,
  type CalendarEvent,
  type ConnectorAccount,
  type ConnectorSettings,
  type RsvpAnswer,
} from "@murmur/shared";
import { ConnectorError, type ConnectorService } from "../connector-service";
import {
  CalendarFetchError,
  GOOGLE_CALENDAR_ID,
  GOOGLE_ORIGIN,
  respondGoogleEvent,
} from "./google-calendar";
import { GRAPH_ORIGIN, respondOutlookEvent } from "./outlook-calendar";

export type RespondResult = { ok: true } | { ok: false; message: string };

/**
 * Answers a meeting invitation (NT-02). It writes to the calendar, so it needs what creating an
 * event needs: the connector's read-only switch off and the write permission. The caller asks the
 * owner to confirm each answer before it calls `respond`.
 */
export interface EventResponder {
  /** Whether this invitation can be answered from here and has not been accepted. */
  canRespond(event: CalendarEvent): boolean;
  respond(event: CalendarEvent, answer: RsvpAnswer): Promise<RespondResult>;
}

export function createEventResponder(deps: {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  settings(): ConnectorSettings;
  /** Called after an answer was sent, so the calendar can be read again. */
  onAnswered?(accountId: string): void;
}): EventResponder {
  const writable = (accountId: string): ConnectorAccount | null => {
    const account = deps.connectors.list().find((entry) => entry.id === accountId);
    if (!account || account.status !== "connected") return null;
    const entry = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === account.connector);
    const scope = CALENDAR_WRITE_SCOPES[account.connector];
    if (!entry || !scope || connectorChoice(deps.settings(), entry).readOnly) return null;
    return hasScope(account.scopes, scope) ? account : null;
  };

  /** An event the owner was invited to: other people's, with the owner on its list. */
  const invited = (event: CalendarEvent) =>
    event.attendees.some((attendee) => attendee.self && !attendee.organizer);

  return {
    canRespond: (event) =>
      event.response !== "accepted" && invited(event) && writable(event.accountId) !== null,

    async respond(event, answer) {
      const account = writable(event.accountId);
      if (!account) return { ok: false, message: "That calendar cannot be written to now." };
      const google = account.connector === GOOGLE_CALENDAR_ID;
      const origin = google ? GOOGLE_ORIGIN : GRAPH_ORIGIN;
      const send = google ? respondGoogleEvent : respondOutlookEvent;
      try {
        await send({
          fetch: (url, init) => {
            // The token only ever goes to the calendar's own address.
            if (new URL(url).origin !== origin)
              throw new CalendarFetchError("Refused a request to another address.");
            return deps.connectors.authorizedFetch(account.id, url, init);
          },
          eventId: event.id,
          answer,
        });
        deps.onAnswered?.(account.id);
        return { ok: true };
      } catch (error) {
        if (error instanceof CalendarFetchError || error instanceof ConnectorError)
          return { ok: false, message: error.message };
        return { ok: false, message: "Murmur could not reach the calendar. Nothing was sent." };
      }
    },
  };
}
