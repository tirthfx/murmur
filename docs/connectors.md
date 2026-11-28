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

**Other calendars.** The main calendar is always read. "Choose calendars" on the account adds up to ten of the others (`connectors.settings.calendars`, per account; Google's `calendarList`, Graph's `me/calendars`, both within the read scope). A meeting on several calendars is kept once, as the main calendar has it (same id, or same title and times). On another calendar the owner is found by address only, since the provider's own "self" means that calendar's owner. A chosen calendar that is gone is passed over and logged. Events are created and invitations answered on the main calendar only.

**Not built:** incremental sync (`syncToken`, delta query): the window is small enough to read whole. Creating an event is described under Calendar events below.

**Manual check:** with your own OAuth app, enter its client id (and secret for Google) on the Connectors page, connect, and press "Read now": the count is the events of the next week. Change an event in the calendar and press Read now again. Revoke the app in your Google or Microsoft account and check the account shows "Needs attention" after the next read.

## Slack, Notion, Linear and GitHub (CN-05 to CN-08)

Four read connectors on the framework. Each one reads only what its documented scopes allow, only what the owner selected, and hands the result to the rest of Murmur as `ConnectorItem`s (`packages/shared/src/connector-data.ts`): an id, the connector, a kind (message, page, issue, pull request), a title, plain text, whether the text was cut, the time of the last change, an address in the provider and a few labels. Briefs and Ask read these items (`connectors/data/connector-data.ts`, `items()`); nothing else reads a provider. They need the owner's own app at each provider, entered on the Connectors page like the calendars.

| Connector | App to register                                                                                              | Redirect address                        | Reads                                                                                                                            | Selection (setting)                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Slack     | A Slack app with the user scopes `users:read`, `channels:read`, `channels:history`, `groups:read`, `im:read` | `http://127.0.0.1:17821/callback`       | Names of people and public channels; the latest 30 messages a channel, from the last 7 days                                      | `connectors.slack.channels`: none until chosen                            |
| Notion    | A public integration                                                                                         | `http://127.0.0.1:17822/callback`       | Pages shared with the integration: title, last edit, text up to `connectors.notion.maxCharsPerPage` (10,000)                     | Notion's own sharing                                                      |
| Linear    | An OAuth application with the `read` scope                                                                   | `http://127.0.0.1:17823/callback`       | Issues assigned to the owner (all states, changed in the last 14 days); with `assignedOnly` off, those of the selected teams too | `connectors.linear.teams` (none), `connectors.linear.assignedOnly` (true) |
| GitHub    | A GitHub App (preferred) or an OAuth app, see ADR-0086                                                       | any (the port is ignored for 127.0.0.1) | Issues and pull requests assigned to the owner or mentioning them, state and labels                                              | `connectors.github.repos`: none until typed                               |

**Fixed ports.** Slack, Notion and Linear match the redirect address exactly, so each listens on its own fixed port; the page tells the owner which address to register.

**Only what is selected.** Slack reads the history of a selected channel only (a channel that is not selected is never asked about) and lists public channels only unless "Include private channels" is on, which also asks Slack for `groups:history` (the card shows "Give permission" for an account that lacks it). GitHub asks about the repositories in the list only, and only for names written `owner/name`; a repository the sign-in cannot see is skipped and logged. Notion shows only pages shared with the integration, because Notion shows nothing else; a page over the limit is cut and marked (`truncated`, tag `cut`). Linear caches only the owner's issues and those of selected teams. Items are also filtered by the current selection when read, so a channel or repository taken out of the list disappears at once, before the next read.

**Nothing goes to another provider.** Each read goes only to its provider's own address (`slack.com`, `api.notion.com`, `api.linear.app`, `api.github.com`) with that account's token, and a request to any other address is refused before it is made. What is kept is per account and is deleted with it.

**Kept for a while.** A read replaces what the account had in `connector_cache` and keeps it for the longer of the cache time (15 minutes) and two sync intervals, so it is there until the next read. The interval is 30 minutes unless the owner chose another; a read also runs when the account connects and from "Read now". A closed Linear issue shows as closed at the next read. GitHub uses conditional requests (ETag): a `304` keeps the items already kept for that address and costs no rate limit.

**Rate limits.** A busy answer (`429`, or GitHub's `403` with `Retry-After`) is waited out for as long as the provider says and asked again, up to three times; a provider that asks for more than 30 seconds, or stays busy, ends the read with a plain message and what was kept stays.

**Provider differences handled by the framework.** `ConnectorProvider` gained `scopeParam` and `scopeSeparator` (Slack sends user scopes in `user_scope`, comma separated; Notion sends none), `tokenAuth` and `tokenBody` (Notion proves the app with HTTP Basic and a JSON body), `tokenHeaders` (Notion's version header) and `parseTokenResponse` (Slack nests the user's token in `authed_user`).

**Not built:** Notion pages as meeting links, private Slack channels and direct messages, walking a Notion page's nested blocks and child databases, GitHub revoke from Murmur (revoke the grant in GitHub), and Ask reading the items. Briefs (`docs/notetaker.md`, Meeting briefs) read these items, and Gmail threads through `connectors/gmail/gmail-threads.ts`.

**Manual check:** register your own app at the provider with the redirect address above, enter its client id and secret, connect, then choose what to read (channels, teams, repositories) and press "Read now": the Connectors page says how many items are kept. Take a channel out of the selection and check the count drops at once.

## Zoom and Fireflies import (CN-09, CN-10)

Meetings from Zoom and Fireflies come in through the transcript importer (NT-21, `docs/notetaker.md`, Importing transcripts), with the same preview, the same duplicate checks and the same writer, on the Connectors page. Nothing is listed until asked, nothing is downloaded until a meeting is picked, and nothing is made until the preview is confirmed (`connectors/data/connector-import.ts`).

- **Zoom** (the owner's own user-managed OAuth app with permission to read cloud recordings; redirect address `http://127.0.0.1:17824/callback`; the app proves itself with HTTP Basic and the scopes are set in the app, so none is sent). "List meetings" shows the cloud recordings of the last `connectors.zoom.rangeDays` days (30; Zoom lists a month at a time) with whether each has a finished WebVTT transcript file. "Import…" downloads that file with the account's token, parses it as a Zoom transcript (speaker names and times from the file) and shows the preview. The download link is read from Zoom when the meeting is picked and is never kept. The file is held in memory and never written to disk, so there is nothing to clean up after success or failure. Audio is not downloaded.
- **Fireflies** (the owner's personal API key, no OAuth app). The key is asked once on the card, checked by asking Fireflies whose key it is, and kept in the Keychain; a key Fireflies does not accept shows "Key rejected." and stores nothing. It is sent only as the `Authorization` header to `api.fireflies.ai`, from main, and never logged. "List meetings" shows the transcripts of the last `connectors.fireflies.rangeDays` days (30); an import brings the sentences with speaker names and times, and, when `connectors.fireflies.importProviderSummary` is on (default), Fireflies' own summary as a separate summary labelled "Fireflies summary (imported)" with `model_id` `fireflies`. A local summary is not written over it by itself: such a meeting gets no automatic local summary (its tasks are looked for in the transcript instead), and the owner can still write one from the Summary tab.
- **Duplicates.** The meeting keeps the service's own id in `meetings.external_ref` (`zoom:<meeting UUID>`, `fireflies:<transcript id>`, migration 0046; a unique index). The same recording is never imported twice: the list marks it Imported, the preview says "already imported" and cannot be confirmed, and the confirm refuses it. The importer's other check (a meeting with the same title at about the same time) still applies and can be overridden.
- **Not built:** auto-import (`connectors.<id>.autoImport`; imports are always picked by the owner), Zoom audio, Fireflies speakers merged with Murmur's own, and a check against the real Zoom and Fireflies APIs (the answers are read as documented and tested with fakes).

**Manual check:** register your own Zoom app (recording read scope, redirect address above) and connect it; List meetings, pick one with a transcript, check the preview shows the speakers, confirm, and check the meeting is in Notetaker. List again and check it is marked Imported; import it again from the list and check it is refused. For Fireflies, paste your key: a wrong one says Key rejected; with the right one, import a transcript and check the speaker names and the labelled summary.

## Sending to Slack and tags (CN-05, CN-14)

**Send to Slack** is the third built-in action (`post_to_slack`, off until turned on in Extensions). It is on an open task and under a meeting's summary. It needs the Slack connector with **Read only turned off** and the user permission `chat:write`, which is asked for only then (the card shows "Give permission" for an account that lacks it); posting is as the owner, to a channel they are in (private ones when "Include private channels" is on). The flow has two steps and no shortcut:

1. **Write.** The message starts from the task or the summary (up to 3,000 characters), is plain text, and can be edited; the owner picks the channel from the same list.
2. **Preview, then Send.** "Preview" builds what would be posted and holds it in Murmur for 15 minutes (`connectors/slack/slack-post.ts`). It shows the channel, the exact message, every tag and every mention that stays plain text. Nothing is posted yet. "Send this message to Slack" posts that held message and nothing else: the call carries only the preview's token, so the text cannot change between the preview and the post, and a preview can be sent once. If Slack fails the preview is kept, so it can be sent again without rewriting it; a busy answer (`429`) is waited out and the same message is sent again.

Slack's own characters (`<`, `>`, `&`) are escaped, so typed text cannot become a link, a `<!channel>` broadcast or a tag, and links are not unfurled. With tagging off (the default) a `@name` is plain text and no list of people is read.

**Tagging (CN-14)** is behind the experimental option `experimental.slackTagging` (off; Settings, Experimental, "Tag people in Slack messages"). With it on, `@dana`, `@dana.lee` or `@dana@example.com` in the message is matched to the workspace's people (`users.list`, bots and deactivated accounts left out): an address matches by email, a name matches a handle, display name or full name ignoring spaces and punctuation, and a first name matches when only one person has it. A mention that matches exactly one person becomes `<@U…>` and is listed in the preview ("These people will be tagged and told"); one that fits two people or no one is **sent as plain text and listed as not tagged**, never guessed. Tags come only from the message text, which is the preview, so no tag can be in a sent message that was not shown. (Slack's user list has emails only with the `users:read.email` permission, which is not asked for, so in practice names match.)

**Not built:** direct messages, searching Slack (the spec avoids that permission unless needed, and nothing needs it), the Slack `sendConfirm` setting (a preview is always required), and checking the Slack calls against a real workspace (tested with fakes).

**Manual check:** with a Slack app of your own, connect Slack, turn Read only off and press "Give permission"; turn on Send to Slack in Extensions. On a task press "Send to Slack", edit the message, choose a channel and preview it; check the message and channel are exactly what you expect, then send it and check it in Slack. With tagging on, mention a colleague and check they are listed before sending; mention two people with the same first name and check the name is listed as not tagged.

## Ask connector actions (CN-13)

Behind the experimental option `experimental.askConnectorActions` (off; "Ask can propose connector actions"). With it off, Ask looks and works exactly as before: no model call about actions, nothing in the window. With it on, a request typed in Ask that **starts as an order** ("Draft a follow-up to Priya about the timeline", "Can you schedule…", "Post the summary to Slack") is shown to the local model, which says whether it is an action or only a question and fills in a form (`connectors/ask-actions.ts`). A question that merely contains a verb ("Did we create an event for the offsite?", "What did we say about drafting it?") never reaches the model for this, and one the model calls an answer makes no proposal; Ask then answers as usual.

- Only an action that is **ready** (on in Extensions, its connector connected and permitted) can be proposed; the proposal is one of draft email, create event or send to Slack.
- The proposal is a card above the question box: one line saying what is proposed, a note when something needs the owner (no one called "Priya" was found among the people in Murmur's meetings, or two people are, so the owner chooses a contact or types an address; no time was given, so the event starts tomorrow morning), and the same editor as for a task, filled in. Nothing is sent or created and no provider is called until the owner confirms in that editor. For Slack the card shows only the message; the channels are read when the owner goes on to the preview.
- The confirmation is the action's own click through the runner (`extensions/action-runner.ts`), and the record is kept as source `ask` (`automations`, an id made for the request).
- **Not built:** creating Linear issues, and picking a contact from a contact card (NT-12): people come from the attendees of meetings Murmur has.

**Manual check:** turn the option on, then in Ask type "Draft a follow-up to <a colleague> about the timeline": a card appears with a draft; nothing is in Gmail until you click Create the draft. Then type "Did we draft a follow-up to <that colleague>?" and check it is answered normally with no card. Turn the option off and check the first request is answered as an ordinary question.

## Calendar events (NT-28)

A task, or a meeting's summary, can become a calendar event: **Create event** on an open task and **Create a follow-up event** under a summary. It uses the calendar's own write permission, and that is asked for only when the owner turns the connector's **read only** switch off on the Connectors page (Google: `calendar.events`; Microsoft: `Calendars.ReadWrite`). `connectOptionsFor` builds the sign-in's scopes from that switch, and the card shows "Give permission" for a connected account that does not have the scope yet. The button is off, with the reason next to it, while no calendar is connected, a calendar needs attention, every calendar is read only, or the permission has not been given.

The form is filled in and shown first: the title (the task's, or "Follow-up: <meeting>"), the due morning at 09:00 (tomorrow at 09:00 when there is no due day or it has passed), the default length (`notetaker.automations.createEvent.defaultDuration`, 30 minutes), the people invited to the meeting (the owner is left out) to add one by one, another address, and a description (the task's notes and where it came from). The date and time are the owner's local ones; a start in the past is refused. Nothing is created until **Create the event** is clicked, and then exactly one request is made (`POST calendars/primary/events` for Google, `POST me/events` for Microsoft), only to the calendar's own address.

**Who is told.** Invitations are sent only when `notetaker.automations.createEvent.sendInvites` is on (default off, Settings, System, Follow-up events) **and** the box on the form is ticked (unticked each time). Otherwise Google gets `sendUpdates=none` and the people are listed on the event without a notice. Microsoft tells everyone on an event the moment it is created, so with invitations off the people are not added to the event: they are named in its text ("To invite: ...") and nobody is notified.

**What is kept.** One `automations` row for each event (action `create_calendar_event`): the source, the title, the start, the provider's event id (`result_ref`) and the address of the event (`open_url`), which is opened only if it is an https address of the calendar service. The new event is read into the calendar cache at once. Disconnecting keeps the rows and switches the action off. Not built: choosing a calendar other than the primary one, repeating events, adding a meeting link, answering an invitation.

**Manual check:** with a calendar connected, turn off Read only on its card and press "Give permission". On an open task press "Create event", change the time, add a person, create it, and open it from the task: it is in your calendar and nobody was told. Turn on "Allow sending invitations", tick the box, create another, and check the invitation arrives.

## Extensions (CN-12)

The **Extensions** page of the Hub lists what connected apps can do for tasks and summaries. In M6 that is a fixed set of built-in actions, not code from anywhere else: **Draft email** (Gmail) and **Create event** (Google Calendar or Outlook). Each has its own connector, a permission it asks for, and a confirmation that is always required (`EXTENSION_ACTIONS` in `packages/shared/src/extensions.ts`). Murmur does not load or run third-party extension code (ADR-0087).

- **Settings** (`extensions.settings`): `enabled` (true) and one switch for each action, off until the owner turns it on. An action is on when extensions are on, its switch is on, an account of its connector is connected, and the connector's own switches allow it (drafting on and the compose permission given for Gmail; read only off and the write permission given for a calendar).
- **Hidden, not greyed out.** An action that is off, or whose connector has no account, is left out of the task and summary screens (`ExtensionActionState.hidden`); drafts and events it already made stay listed. An action whose account needs attention or lacks a permission is shown with the reason.
- **Only a click runs an action** (`extensions/action-runner.ts`). All action calls from the window go through `ActionRunner.run(id, input, click)`, which refuses without a `UserClick`, checks the state, validates the input with the action's own schema, and calls the action once. A `UserClick` is made by `fromUserClick()` only in the handlers in `main.ts` for the window's own click (a unit test checks that no other source file uses it). A model's answer can only become an `ActionProposal` through `parseProposal`, which describes an action and its input and runs nothing, even if the text says it is confirmed.
- **An extension cannot read a token.** Actions are built-in code reached only through two things the runner is given for each (whether it can be used, and the call that does it); the runner holds no connector service, and an action is called with its input alone. Tokens stay in the connector service and the Keychain.
- **Not built:** creating Linear issues, which the page lists as not built; extensions from other developers, team-shared extensions (M7), and a sandbox for third-party code. "Send to Slack" is the third action (below).

**Manual check:** open Extensions: both actions are off. On a task, no "Draft email" or "Create event" button appears. Turn on "Draft email" with Gmail connected and drafting allowed: the button appears on an open task. Disconnect Gmail: it disappears again.

## Gmail and email drafts (CN-04, NT-27)

Gmail is the same Google sign-in as Google Calendar, with its own client id on the Connectors page (it can be the same Google Cloud project). Signing in asks only for who the account is (`openid`, `email`). A mail permission is asked for only when the feature that needs it is turned on, in the Gmail card of the Connectors page:

| Setting (`connectors.gmail`)                                  | Default | Permission asked for |
| ------------------------------------------------------------- | ------- | -------------------- |
| `briefContext`: read recent mail with the people in a meeting | off     | `gmail.readonly`     |
| `draftEnabled`: create drafts from tasks and summaries        | off     | `gmail.compose`      |
| `maxThreadsPerBrief`                                          | 5       | none                 |

`connectOptionsFor` (`connectors/connect-options.ts`) builds the scope list for a sign-in from these settings, and `include_granted_scopes` keeps what was given before. Turning a feature on for an account that was connected earlier shows "Give permission", which signs in again with the extra scope. Turning a feature off stops Murmur using it; Google keeps the permission until the account is disconnected and connected again. There is never a scope that sends: `gmail.send` and `gmail.modify` are not in the code.

**Drafts.** "Draft email" is on an open task (My Tasks and a meeting's Tasks tab) and under a meeting's summary. It is switched off, with the reason next to it, when drafting is off, Gmail is not connected, an account needs attention, or the compose permission has not been given. The local model proposes a subject and text from the task (and its meeting) or from the latest summary, as JSON that is checked; if it fails or answers badly, a plain starting text is used. The window then shows the recipient (the people invited, the task owner's name picked when exactly one fits, or any one address, or nobody), the subject and the text, all editable and all plain text. Nothing is created until "Create the draft in Gmail" is clicked, and then one `POST users/me/drafts` is made, which is the only write in the connector. The recipient must be one plain address, a subject has no line breaks, and control characters are removed, so nothing typed or written by the model can add a header or another recipient. The result can be opened in Gmail from the page.

**What is kept.** One `automations` row (migration 0044) for each draft: the source (task or meeting), the recipient, the subject, the draft's Gmail id (`result_ref`) and its address. The text of the draft is not kept. Disconnecting the account keeps the rows (the account is set to null) and switches the action off; removing a row never deletes the draft in Gmail.

**Reading mail.** `recentThreadsWith` (`connectors/gmail/gmail.ts`) finds the latest threads with some addresses and returns them as plain text: the plain part when a message has one, otherwise the HTML as text (never rendered). Attachments are never fetched: a part with a file name or an attachment id is skipped, and no request to the attachments address is ever made. Meeting briefs, which use it, come later (#223); until then nothing reads mail.

**Manual check:** add the client id and secret for Gmail, connect, turn on "Let me create drafts" and press "Give permission". On an accepted task press "Draft email", change the text, create it, and open it: it is in Gmail's Drafts folder, and Sent is unchanged.

## Adding a provider

A provider is a `ConnectorProvider` (`connectors/providers.ts`): id, name, authorize and token addresses, an optional revoke address, scopes, extra sign-in parameters, a fixed loopback port when it needs an exact redirect, and `accountLabel`, which asks the provider for the account's email. Add it to the list in `createConnectorRegistry([...])` in `main.ts`; its id must match an entry in `CONNECTOR_CATALOGUE`. The framework and the page do the rest.

## Manual check

The Keychain part can be checked with `npm run test:helper`, which runs the helper's tests with a fake Keychain. A real sign-in needs your own OAuth app for the provider (see each connector's card).
