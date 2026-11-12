// A small .gitignore reader for the workspace index (PZ-24): comments, blank lines, negation
// with "!", folder-only rules ending in "/", anchored rules (a "/" before the end), and the
// globs *, ? and **. Escapes and character classes beyond [abc] are not needed here.

interface Rule {
  regex: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globToRegex(glob: string, anchored: boolean): RegExp {
  let out = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        // "**/" matches any folders, "/**" anything below, a lone "**" anything.
        if (glob[index + 2] === "/") {
          out += "(?:.*/)?";
          index += 2;
        } else {
          out += ".*";
          index += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "[") {
      const end = glob.indexOf("]", index);
      if (end > index) {
        out += glob.slice(index, end + 1);
        index = end;
      } else {
        out += "\\[";
      }
    } else {
      out += char.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }
  return new RegExp(`${anchored ? "^" : "(?:^|/)"}${out}$`);
}

export function parseGitignore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+$/, "");
    if (line === "" || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (line === "") continue;
    rules.push({ regex: globToRegex(line, anchored), negate, dirOnly });
  }
  return rules;
}

/**
 * Whether `path` (relative to the folder the rules came from, with "/") is ignored. The last
 * matching rule wins, as in git.
 */
export function isIgnored(rules: readonly Rule[], path: string, isDir: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(path)) ignored = !rule.negate;
  }
  return ignored;
}

export type GitignoreRules = Rule[];
