# Developer apps

Developer features (vault spec PZ-26, PZ-27) act only in the Developer category: code editors
and terminals from the default app table (VS Code, Cursor, Windsurf, Zed, Xcode, JetBrains
IDEs, Sublime Text, Nova, Terminal, iTerm2, Warp), or any app the owner puts in Developer on
the Styles page. Elsewhere the same phrases stay as words.

## Spoken syntax

One rule table for every language (`apps/desktop/src/main/developer/syntax.ts`). It runs right
after the dictionary stage, before cleanup, so the model sees `--help`, not "dash dash" (the
model drops a repeated word as a stutter).

| Say                                       | Get                                             |
| ----------------------------------------- | ----------------------------------------------- |
| camel case user id                        | `userId`                                        |
| snake case user id                        | `user_id`                                       |
| pascal case http client                   | `HttpClient`                                    |
| kebab case main page                      | `main-page`                                     |
| constant case max retries                 | `MAX_RETRIES`                                   |
| dash dash help / dash f                   | `--help` / `-f`                                 |
| dot, slash, back slash, colon, underscore | `.` `/` `\` `:` `_`, joined to the words around |
| equals                                    | `=`                                             |
| open/close paren, bracket, brace          | `(` `)` `[` `]` `{` `}`                         |

A case command takes the words after it up to punctuation, a symbol, another case command or a
joining word (to, and, or, in, from, with, as, for, then, is, on, at, by, of, if, when…).
Pause commas the recogniser puts between syntax words are dropped.

Output: identifiers and paths made by the rules are written back exactly after cleanup. A
single line is kept as a command: no sentence capital (unless the word is a dictionary or pack
term, or "I") and no final full stop, comma or semicolon; `?` and `!` stay. Several sentences,
several lines, or "full stop" said at the end keep the text as prose.

## Jargon packs

Murmur's own term lists, plain JSON in `apps/desktop/src/main/developer/packs/` (at most 500
terms each, checked when main loads). Each pack has `terms` (written exactly as listed) and
`heard` (what recognition often makes of a term, for example "cube control" for `kubectl`).
On by default: Git and GitHub, package managers, web. Off: cloud CLIs and tools, databases.
Switches are on the Dictionary page ("Developer word packs"); settings key
`developer.jargon_packs`.

In a Developer app the packs that are on:

- join the speech prompt after starred dictionary terms and before the most used ones, a term
  from each pack in turn, within the 400-character term budget;
- turn heard forms into the term and fix its case, after the owner's own dictionary entries;
- give the terms found in the text to the cleanup model to keep as written.

The log says which packs were used: `developer app: packs git, packages, web`.

## Manual test

1. In Terminal, dictate "dash dash help": `--help`. In VS Code, "camel case user id": `userId`.
2. In Messages, dictate "camel case user id": it stays as words.
3. Turn on Cloud CLIs and tools. In Terminal, dictate "run kubectl apply", "kubectl get pods"
   and "check the kubeconfig": `kubectl` and `kubeconfig` as written. Turn the pack off: the
   log no longer lists `cloud`.
