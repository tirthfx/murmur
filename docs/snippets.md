# Snippets

Snippets (vault spec PZ-08, PZ-09): say a trigger phrase on its own and Murmur inserts the
saved text exactly as written. Managed on the Hub's Snippets page.

## When a trigger fires

- The whole dictation is the trigger ("my address"), or
- one whole sentence of the dictation is ("Please send it here. My address. Thanks!").

Case and punctuation do not matter. A trigger inside a longer sentence ("I changed my
address") stays ordinary text. Matching runs after the dictionary stage and before cleanup.

## The body is never changed

The text around a trigger is cleaned on its own (one cleanup call per piece, within the
same time budget), so the cleanup model never sees the body. The pieces are put back
together: a one-line plain body joins the sentence; a body with several lines, or a rich
one, starts on its own line.

## Rich text

The editor offers bold, italic, underline, bulleted and numbered lists, and links (http,
https and mailto only). A body without any of these is stored as plain text. A rich body is
stored as a small JSON document (paragraphs and lists of styled runs) and turned into:

- **HTML**, sent to the helper with `insert.text` as `html`. The helper puts it on the
  pasteboard beside the plain text, so apps that take rich text get the formatting.
- **Plain text**, for typed insertion, terminals (whose trailing newlines are trimmed, so
  they get plain text only) and plain-text fields. Lists become `• item` and `1. item`
  lines; a link keeps its address in brackets.

Limits: 1,000 snippets, triggers of 2 to 60 characters, bodies up to 20 KB.

## Bulk import

Experimental, like the dictionary's. A `.csv` file (`trigger, text`; the text may span lines
inside quotes) or a Markdown file with a heading per snippet and its text below. Triggers
already saved are skipped. Imported bodies are plain text. Limits: 2 MB, 1,000 snippets.
Code: `apps/desktop/src/main/imports/`.

## Storage

Table `snippets` (migration `0004_snippets.sql`), as in the vault's data model. Code:
`apps/desktop/src/main/snippets/` (store, `match.ts`), `packages/shared/src/snippets.ts`
(document model and converters), `apps/desktop/src/renderer/hub/SnippetsPage.tsx` and
`rich-text.ts` (reads the editor into the document model).

## Manual test

1. Add trigger "my address" with three lines. Dictate "my address" into Notes: the three
   lines appear.
2. Make one word bold and add a link. Dictate the trigger into Notes or Mail: bold and the
   link survive. In TextEdit set to plain text, the same lines arrive without formatting.
3. `npm run smoke -- --full` checks a trigger with real speech (the test box is plain text).
