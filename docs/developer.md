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

## File tags (off by default)

In Cursor, VS Code, VS Code Insiders, Windsurf and Zed, "at" plus a file name with a dot or a
slash becomes a tag: "look at session dot ts" gives `look @src/auth/session.ts`. Matching is by
file name, then by path suffix ("auth slash session dot ts"); with several matches the exact
case and then the shortest path wins. Unknown names, and words such as "at noon", stay text.

The workspace comes from the window title. Editors show the project folder's name there
("session.ts — shop"), so Murmur looks for that name among the owner's code folders (Dictionary
page, "Code folders", for example `~/Developer`): the folder itself or a folder directly inside
it. A full path in the title is used as it is when it is inside the home folder.

The index is built in main when a recording starts: every file under the root, following each
`.gitignore` on the way, never `.git` or `node_modules`, never following links, at most 50,000
files. It is reused for a minute. If it is not ready 1.5 s after the speech model finishes, the
dictation goes on without tags.

## Names on screen (off by default)

Identifiers in the text around the caret (camelCase, snake_case, PascalCase, kebab-case, at most 500) replace the same words spoken: "call fetch user profile" gives `call fetchUserProfile`.
The first 20 also go into the speech prompt. They are used for that dictation only. VS Code and
Cursor show their text to other apps only with screen reader mode on; when the editor shows no
text, the Bar says so once per app per run and nothing else changes. Needs context awareness.

## Coding tools in the terminal (off by default)

In Terminal, iTerm2, Warp, Ghostty, Alacritty, kitty, WezTerm and Hyper, a listed coding tool
(claude, codex, gemini, aider, cursor-agent, opencode, goose, amp, crush, qwen; editable) makes
the dictation a Developer one, with syntax and packs. Checked once per dictation: the helper's
`proc.foreground` request returns the names of the processes under the app in front (for node
and python tools, the script's name; never arguments), and the window title is checked for the
names too. With several tabs, a tool running in any tab counts. Nothing about the processes is
logged by name or written to history.

## Manual test

1. In Terminal, dictate "dash dash help": `--help`. In VS Code, "camel case user id": `userId`.
2. In Messages, dictate "camel case user id": it stays as words.
3. Turn on Cloud CLIs and tools. In Terminal, dictate "run kubectl apply", "kubectl get pods"
   and "check the kubeconfig": `kubectl` and `kubeconfig` as written. Turn the pack off: the
   log no longer lists `cloud`.
4. File tags: add your code folder, open a project in VS Code, dictate "look at" and a file
   name with its extension: the tag is inserted. A name not in the project stays as words.
5. Names on screen: turn on screen reader mode in VS Code, have `fetchUserProfile` on screen,
   dictate "call fetch user profile".
6. Coding tools: turn detection on, put Terminal in Work on the Styles page, run `claude` and
   dictate "dash dash help": `--help`. Quit it: the words stay.
