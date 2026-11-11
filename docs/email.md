# Email

Email features (vault spec PZ-20 to PZ-23): a signature, an email language and writing
samples. They act only in the Email category (mail apps and webmail pages, see
`docs/styles.md`). Set them on the Hub's Styles page, under "Email signature and language".

## Signature

Plain text with line breaks, up to 500 characters. After cleanup, translation and the style's
rules, the signature is added after a blank line. It never goes through the cleanup model.

- New messages get it when "Add to new messages" is on (the default).
- Replies get it only when "Add to replies" is on (off by default). A reply is a window whose
  title starts with "Re:" (also "RE[2]:"). Reading reply buttons on a page is not done yet.
- It is not added when the text already ends with it, for example when the owner said it.
  The check ignores case, spaces and punctuation.
- In a dictation with a rich snippet, the signature is added to the plain text and as a last
  paragraph of the HTML.
- "Split into messages" (experimental) does not add a signature or translate.

## Email language

"Same as dictation" (the default) translates nothing. With another language, Email-category
text is translated after cleanup by the same local model, in its own 6 s limit (apart from the
1.5 s cleanup budget). Nothing runs when the detected dictation language is already the email
language.

The answer is used only if every link, email address and number in the text, and every
dictionary or on-screen term in it, is still there unchanged, and its length is sane. On a
timeout, a refused answer or no model, the text goes in untranslated and the Bar says "Not
translated: inserted as dictated".

Benchmark: `node scripts/bench-translate.mjs [language]`. On the M2 model (Qwen3 4B, 4-bit),
French: p50 about 1.05 s, p90 about 3 s, none over 6 s, 6 of 8 accepted. The two refusals
were an amount written the French way ("1 250") and a prompt-injection line; both fell back to
the dictated text.

## Writing samples

Up to 10 samples of the owner's own writing, 20 KB (UTF-8 bytes) each, with a label. Paste
text or choose a plain text file; other files, and files over 20 KB, are refused with the limit
shown. Samples are not used by cleanup. Rewrites (M3) will use them.

## Learn from sent mail

Shown under Experimental, always off and disabled: it needs a mail connector.

## Storage

Settings key `email.settings` (signature, addToNew, addToReplies, language). Table
`writing_samples` (migration `0009_writing_samples.sql`). Code: `packages/shared/src/email.ts`
(signature rules), `apps/desktop/src/main/email/`, the `translate` request of the LLM worker,
`apps/desktop/src/renderer/hub/EmailSection.tsx`.

## Manual test

1. Set a signature. Put Mail in the Email category (the default). In a new message, dictate a
   sentence: the text, a blank line, then the signature, once.
2. Dictate in a reply ("Re:" in the title): no signature unless "Add to replies" is on.
3. Dictate in Messages (Personal): no signature.
4. Set the email language to French and dictate English in Mail: French text, then the
   signature. In Notes nothing is translated.
5. Choose a 25 KB text file as a sample: it is refused with "samples can be up to 20 KB".
