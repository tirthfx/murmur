# Connectors

The framework every connector (a calendar, mail, chat) is built on (CN-01). It has no provider yet: Google Calendar and the rest are added to the registry one by one in M6. Everything here is tested against a fake provider and a fake Keychain, because the real providers need the owner's own OAuth apps.

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

## Adding a provider

A provider is a `ConnectorProvider` (`connectors/providers.ts`): id, name, authorize and token addresses, an optional revoke address, scopes, extra sign-in parameters, a fixed loopback port when it needs an exact redirect, and `accountLabel`, which asks the provider for the account's email. Add it to the list in `createConnectorRegistry([...])` in `main.ts`. The framework does the rest.

## Manual check

There is nothing to connect until the first provider (M6). The Keychain part can be checked now: `npm run test:helper` runs the helper's tests with a fake Keychain; the real Keychain is used by the first connector.
