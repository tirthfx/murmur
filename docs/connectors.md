# Connectors

The framework every connector (a calendar, mail, chat) is built on (CN-01), and the providers built on it. Google Calendar and Outlook calendar are in (see Calendars below); the rest are added to the registry one by one in M6. Everything is tested against fake providers and a fake Keychain, because the real providers need the owner's own OAuth apps.

## What is kept, and where

| What                                        | Where                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| Access and refresh tokens, their expiry     | The Mac's Keychain, one generic password per account                              |
| Which accounts are connected, their state   | `connector_accounts` (migration 0040): provider, email, scopes, status, last sync |
| What was fetched for an account             | `connector_cache`: kind, key, JSON, fetched time, time to live                    |
| The owner's OAuth client ids                | `<data>/Murmur/connectors.json`, read each time                                   |
| A client secret, where a provider needs one | A Keychain item, never the file                                                   |

A token is never in the database, in a log or in anything the window can read. The window gets `ConnectorAccount` objects, which have no token field. A test dumps every table and the logs after a connect, a refresh and a disconnect and looks for the tokens.

## Keychain through the helper

The signed Swift helper is the only Keychain client (`keychain.get`, `keychain.set`, `keychain.delete`; capability `keychain`), so no native Node module has to be rebuilt for Electron. Items are generic passwords: service `com.murmur.connector.<id>`, account the email in lower case, the value one JSON text of access token, refresh token, expiry and scopes. They are readable only while the Mac is unlocked and never leave this Mac (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`). Deleting an item that is not there is not an error. The helper never logs a value.

In development the unsigned helper may make macOS ask once for Keychain access; choose Always Allow.

## Connecting

1. The owner chooses a provider. Without an OAuth client id for it in `connectors.json` the answer is "Add the OAuth client id for ... first".
2. Murmur listens on `127.0.0.1` (a port the system chooses, or the provider's fixed port) for one request to `/callback`, for at most 5 minutes.
3. The provider's sign-in page opens in the **system browser** (`shell.openExternal`), never in a web view. The address carries `response_type=code`, the client id, the redirect, the scopes, a random `state`, and a PKCE challenge (S256).
4. The browser comes back to the loopback address. An answer whose `state` differs is ignored and reported; a refusal is reported in words.
5. Murmur exchanges the code with the PKCE verifier, asks the provider which account signed in (its email), keeps the tokens in the Keychain and adds the account row. Connecting an email that is there already reconnects it and keeps its id.

Several accounts of one provider can be connected (a work and a personal one). Each has its own item, status and cache. One sign-in per provider can be open at a time; it can be cancelled.

## Tokens and refresh

`accessToken(id)` is for main only. It renews the token first when it ends within 5 minutes. `authorizedFetch(id, url)` sends it as a bearer header; on a 401 it renews once and asks again, and a second 401 makes the account need attention. Renewing is single flight per account: callers that ask together share one request, and a late 401 for a token that was already renewed does not renew it again. A refresh response without a refresh token keeps the old one.

## Status

- **Connected**: it works.
- **Needs attention**: the provider refused the refresh (a 4xx other than 408 and 429), the token ended with nothing to renew it, or the Keychain item is gone. The reason is kept in plain words. Nothing more is asked of the provider until the owner connects again (the same email keeps the account).
- **Disabled**: the owner turned it off; nothing is fetched.

A busy provider (5xx, 408, 429) or no network does not change the status.

## Disconnecting

Disconnect revokes the token at the provider when it has a revoke endpoint (the refresh token, which ends the access token too), deletes the Keychain item, then deletes the account and, with it, its cache rows. A provider that does not confirm the revoke does not stop the disconnect (the result says `revoked: false`; `null` means the provider has no revoke). If the Keychain item cannot be deleted the account is kept and the error says so, so it can be tried again. Other accounts are not touched.

"Delete all data and reset" disconnects every account first, deletes the client secrets and `connectors.json`, then clears the database.

## Strict local mode

Connecting is refused with the strict local message and nothing is opened; a request to a provider goes through the network guard. With it on, no connector traffic leaves the Mac.

## The Connectors page (CN-15)

A Hub page, after Notetaker. It reads local state only (`connectors:view`, built by `connectors/connectors-view.ts`), so it needs no network, and it never receives a token.

- **What needs a connector:** a list of the features that use connectors (`CONNECTOR_FEATURES` in `packages/shared/src/connectors.ts`), each On or Off. A feature is on when some account of one of its connectors is connected. When it is off the reason says what to do: connect a named connector, reconnect a named account, turn an account back on, or that the connector is not built yet.
- **Connectors:** every connector in `CONNECTOR_CATALOGUE` (Google Calendar, Outlook calendar, Gmail, Slack, Notion, Linear, GitHub, Zoom, Fireflies), whether or not its provider is built. Each card has a status (Not built yet, Needs setup, Not connected, Connected, Needs attention, Disabled), what it reads and can write, the scopes in plain words (a scope asked for only when a feature needs it says so), and the features that use it.
- **Your app:** the OAuth client id (kept in `connectors.json`) and, where the provider needs one, the client secret (saved in the Keychain, never shown again). A connector with no app says what is missing instead of failing; Connect appears when both are set.
- **Accounts:** each account has its email, status, last sync, a switch to turn it off and on, Reconnect when it needs attention, and Disconnect with a confirming click (it follows the rules above). Connect another account adds a second sign-in.
- **A needs-attention account** also shows one banner at the top with a Reconnect button, which signs in again with that email as the hint, so the account keeps its id.
- **Sync interval and read only:** each connected connector has a sync interval (5 minutes to 4 hours; 15 for calendars, 30 for others by default) and, for a connector that can write, a read-only switch that is on until turned off. They are in the setting `connectors.settings` and are used by the syncs that come with each provider. The cache lifetime is 15 minutes.
- **For features:** `ConnectorNotice` (renderer) takes a feature id and shows one banner with the reason and a Reconnect or Open Connectors button when the feature cannot work, and nothing when it can.
- **Local MCP server:** a section at the bottom with the switches for the local MCP server (on, the socket, the web address and its port) and where it is listening; see `docs/mcp.md`.
- The page reads again when the window is focused, so a sign-in finished in the browser or a token that stopped working shows up.

## Calendars (CN-02, CN-03)

Two providers in `connectors/calendar/`. Both read only (no write scope is asked for until follow-up events, #221), sign in with PKCE in the system browser, and need the owner's own OAuth app, entered on the Connectors page.

|              | Google Calendar                                                                                                                                                                                     | Outlook calendar                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| App          | OAuth client of type Desktop app in the owner's Google Cloud project (a client id and a client secret, which Google gives desktop apps and which is kept in the Keychain), the owner as a test user | App registration in Microsoft Entra as a public client (no secret), redirect `http://localhost` |
| Scopes       | `calendar.readonly`, `openid`, `email` (`access_type=offline`, `prompt=consent` for a refresh token)                                                                                                | `Calendars.Read`, `User.Read`, `offline_access` (delegated only)                                |
| Events       | `calendars/primary/events`, repeats expanded, a limited set of fields (no description or attachments)                                                                                               | `me/calendarView`, repeats expanded, times asked for in UTC, no body text                       |
| Link to join | `hangoutLink`, else a `video` entry point                                                                                                                                                           | `onlineMeeting.joinUrl` (Teams), else `onlineMeetingUrl`                                        |
| Revoke       | revoke endpoint                                                                                                                                                                                     | none exists: removed here only                                                                  |

**What is kept.** Each sync reads the events from a day ago to a week ahead (at most 500) and makes the window in `calendar_events` (migration 0042) exactly that: a moved event moves, a cancelled or deleted one goes, the rest is untouched. The table is the common shape `CalendarEvent` (`packages/shared/src/calendar.ts`): title, start and end in UTC, all-day, location, attendees (name, email, answer, who is the owner, the organizer), the join link, the owner's answer and a private flag. An all-day event is whole days here. Cancelled events and Google's working-location notes are not kept. Declined events are kept but left out of lists unless asked for. Disconnecting removes an account's events with it, and events of an account that needs attention or is turned off are not listed.

**When.** `connectors/calendar/calendar-sync.ts` looks every minute for accounts that are due: never synced, or last synced longer ago than the connector's interval (15 minutes for calendars, or what the owner chose on the Connectors page). A sync also runs once at start, right after connecting, and from "Read now" on the page. One sync of an account runs at a time. When the provider does not answer, the events already kept stay and the account is not marked; when the grant was revoked, the next sync's refresh is refused and the account **needs attention** (and its events stop being offered), so a revoked grant shows within one sync interval.

**Nothing leaves but to the provider.** The token and the requests go only to the provider's own address (`www.googleapis.com`, `graph.microsoft.com`; the token address for a renewal): a page address named in an answer (Graph's `nextLink`) that points anywhere else is refused, and a request to another address is refused before it is made. Events are stored in the local database and are not sent anywhere.

**Microsoft work accounts** may need an administrator's consent. The provider's own words are shown on the page when it refuses (for example "AADSTS65001: ..."), for the redirect (`error_description`) and for a refused code. The redirect names `localhost` for Microsoft (`ConnectorProvider.redirectHost`); the listener is on 127.0.0.1 either way.

**Not built:** incremental sync (`syncToken`, delta query): the window is small enough to read whole; the privacy mode that shows private events as "Busy"; choosing calendars other than the primary one; writes (create event, answer an invitation), which come with calendar event automation.

**Manual check:** with your own OAuth app, enter its client id (and secret for Google) on the Connectors page, connect, and press "Read now": the count is the events of the next week. Change an event in the calendar and press Read now again. Revoke the app in your Google or Microsoft account and check the account shows "Needs attention" after the next read.

## Adding a provider

A provider is a `ConnectorProvider` (`connectors/providers.ts`): id, name, authorize and token addresses, an optional revoke address, scopes, extra sign-in parameters, a fixed loopback port when it needs an exact redirect, and `accountLabel`, which asks the provider for the account's email. Add it to the list in `createConnectorRegistry([...])` in `main.ts`; its id must match an entry in `CONNECTOR_CATALOGUE`. The framework and the page do the rest.

## Manual check

There is nothing to connect until the first provider (M6); the Connectors page lists every connector as Not built yet. The Keychain part can be checked now: `npm run test:helper` runs the helper's tests with a fake Keychain; the real Keychain is used by the first connector.
