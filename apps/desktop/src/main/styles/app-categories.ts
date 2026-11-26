import type { AppCategory } from "@murmur/shared";
import { appKey, WINDOWS_TERMINALS } from "../apps/app-id";

// The default app table (PZ-13): which category an app's dictation belongs to. Murmur's own
// list of common apps: Mac bundle ids, and Windows program names in lower case (look them up with
// `appKey`). Anything not listed is Other unless the owner picks.

function windowsCategory(
  category: AppCategory,
  programs: readonly string[],
): Record<string, AppCategory> {
  return Object.fromEntries(programs.map((program) => [program, category]));
}

export const DEFAULT_APP_CATEGORIES: Readonly<Record<string, AppCategory>> = {
  // Email
  "com.apple.mail": "email",
  "com.microsoft.Outlook": "email",
  "com.readdle.smartemail-Mac": "email",
  "com.superhuman.electron": "email",
  "it.bloop.airmail2": "email",
  "com.mimestream.Mimestream": "email",
  "ch.protonmail.desktop": "email",
  "com.fastmail.mac.Fastmail": "email",
  "org.mozilla.thunderbird": "email",
  "com.canarymail.mac": "email",
  "io.missive.desktop": "email",
  "com.hey.app.desktop": "email",
  // Personal messaging
  "com.apple.MobileSMS": "personal",
  "net.whatsapp.WhatsApp": "personal",
  "desktop.WhatsApp": "personal",
  "ru.keepcoder.Telegram": "personal",
  "org.telegram.desktop": "personal",
  "com.facebook.archon": "personal",
  "com.facebook.archon.developerID": "personal",
  "org.whispersystems.signal-desktop": "personal",
  "com.hnc.Discord": "personal",
  "jp.naver.line.mac": "personal",
  "com.tencent.xinWeChat": "personal",
  "com.viber.osx": "personal",
  "com.skype.skype": "personal",
  // Work: team chat, documents, planning
  "com.tinyspeck.slackmacgap": "work",
  "com.microsoft.teams": "work",
  "com.microsoft.teams2": "work",
  "us.zoom.xos": "work",
  "com.google.Chat": "work",
  "notion.id": "work",
  "com.linear": "work",
  "com.atlassian.trello": "work",
  "com.asana.desktop": "work",
  "com.clickup.desktop-app": "work",
  "com.basecamp.bc3-mac": "work",
  "com.microsoft.Word": "work",
  "com.microsoft.Excel": "work",
  "com.microsoft.Powerpoint": "work",
  "com.microsoft.onenote.mac": "work",
  "com.apple.iWork.Pages": "work",
  "com.apple.iWork.Numbers": "work",
  "com.apple.iWork.Keynote": "work",
  "com.figma.Desktop": "work",
  "com.loom.desktop": "work",
  "md.obsidian": "work",
  "com.lukilabs.lukiapp": "work",
  "com.apple.Notes": "work",
  "com.apple.TextEdit": "other",
  "com.apple.reminders": "work",
  "com.culturedcode.ThingsMac": "work",
  "com.todoist.mac.Todoist": "work",
  "com.anthropic.claudefordesktop": "work",
  "com.openai.chat": "work",
  // Developer: code editors and terminals
  "com.microsoft.VSCode": "developer",
  "com.microsoft.VSCodeInsiders": "developer",
  "com.todesktop.230313mzl4w4u92": "developer",
  "com.exafunction.windsurf": "developer",
  "dev.zed.Zed": "developer",
  "com.apple.dt.Xcode": "developer",
  "com.jetbrains.intellij": "developer",
  "com.jetbrains.pycharm": "developer",
  "com.jetbrains.WebStorm": "developer",
  "com.jetbrains.goland": "developer",
  "com.sublimetext.4": "developer",
  "com.panic.Nova": "developer",
  "com.apple.Terminal": "developer",
  "com.googlecode.iterm2": "developer",
  "dev.warp.Warp-Stable": "developer",
  "com.mitchellh.ghostty": "developer",
  "net.kovidgoyal.kitty": "developer",
  "io.alacritty": "developer",
  "co.zeit.hyper": "developer",
  ...windowsCategory("email", ["outlook.exe", "olk.exe", "hxoutlook.exe", "thunderbird.exe"]),
  ...windowsCategory("personal", [
    "whatsapp.exe",
    "whatsapp.root.exe",
    "telegram.exe",
    "signal.exe",
    "discord.exe",
    "line.exe",
    "weixin.exe",
    "viber.exe",
    "messenger.exe",
  ]),
  ...windowsCategory("work", [
    "slack.exe",
    "ms-teams.exe",
    "teams.exe",
    "zoom.exe",
    "notion.exe",
    "linear.exe",
    "asana.exe",
    "clickup.exe",
    "winword.exe",
    "excel.exe",
    "powerpnt.exe",
    "onenote.exe",
    "figma.exe",
    "loom.exe",
    "obsidian.exe",
    "todoist.exe",
    "claude.exe",
    "chatgpt.exe",
  ]),
  ...windowsCategory("developer", [
    "code.exe",
    "code - insiders.exe",
    "cursor.exe",
    "windsurf.exe",
    "zed.exe",
    "devenv.exe",
    "idea64.exe",
    "pycharm64.exe",
    "webstorm64.exe",
    "goland64.exe",
    "rider64.exe",
    "clion64.exe",
    "sublime_text.exe",
    "notepad++.exe",
    ...WINDOWS_TERMINALS,
  ]),
  "notepad.exe": "other",
};

/** Browsers: their category comes from the page's title. */
export const BROWSERS: ReadonlySet<string> = new Set([
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  "com.google.Chrome",
  "com.google.Chrome.canary",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "company.thebrowser.Browser",
  "org.mozilla.firefox",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera",
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "brave.exe",
  "arc.exe",
  "vivaldi.exe",
  "opera.exe",
]);

/** Words in a browser window title that tell what the page is. First match wins. */
export const TITLE_KEYWORDS: ReadonlyArray<readonly [RegExp, AppCategory]> = [
  [/\b(gmail|inbox|outlook|yahoo mail|proton ?mail|fastmail|icloud mail|hey\.com)\b/i, "email"],
  [/\b(whatsapp|messenger|telegram|discord|instagram|signal)\b/i, "personal"],
  [
    /\b(slack|microsoft teams|notion|linear|jira|confluence|asana|trello|google docs|google sheets|google slides|figma|github|gitlab|google meet)\b/i,
    "work",
  ],
];

export type CategorySource = "user" | "default" | "title" | "unknown";

/**
 * The category for a dictation: the owner's choice for the app, then the default table, then
 * (in a browser) the page title, then Other.
 */
export function resolveCategory(
  app: { bundleId: string | null; windowTitle: string | null },
  overrides: ReadonlyMap<string, AppCategory>,
): { category: AppCategory; source: CategorySource } {
  const bundleId = app.bundleId;
  if (bundleId) {
    const chosen = overrides.get(bundleId);
    if (chosen) return { category: chosen, source: "user" };
    const known = DEFAULT_APP_CATEGORIES[appKey(bundleId)];
    if (known) return { category: known, source: "default" };
    if (BROWSERS.has(appKey(bundleId)) && app.windowTitle) {
      for (const [pattern, category] of TITLE_KEYWORDS) {
        if (pattern.test(app.windowTitle)) return { category, source: "title" };
      }
    }
  }
  return { category: "other", source: "unknown" };
}
