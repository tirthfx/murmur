/**
 * The Hub's pages in sidebar order (HB-01). `feature` names the switch that hides a page when
 * it is off; pages whose switch lives on the page itself (My Voice, Memory) are never hidden,
 * or the switch could not be turned back on. Tasks comes with #189.
 */
export const PAGES = [
  {
    id: "home",
    title: "Home",
    emptyTitle: "Nothing to show yet",
    emptyDescription: "Your recent activity will gather here once dictation is switched on.",
  },
  {
    id: "dictation",
    title: "Dictation",
    emptyTitle: "No dictations yet",
    emptyDescription: "Your recent dictations will be listed here.",
  },
  {
    id: "notetaker",
    title: "Notetaker",
    emptyTitle: "No meetings yet",
    emptyDescription: "Recorded meetings, with their notes and transcripts, will be listed here.",
  },
  {
    id: "connectors",
    title: "Connectors",
    emptyTitle: "Nothing connected",
    emptyDescription: "Calendars and other services you sign in to will be listed here.",
  },
  {
    id: "dictionary",
    title: "Dictionary",
    emptyTitle: "No words saved",
    emptyDescription: "Names and terms you teach Murmur will be listed on this page.",
  },
  {
    id: "snippets",
    title: "Snippets",
    emptyTitle: "No snippets yet",
    emptyDescription: "Short phrases that expand into longer text will live here.",
  },
  {
    id: "styles",
    title: "Styles",
    emptyTitle: "No styles defined",
    emptyDescription: "Writing styles for different apps and moods will be managed here.",
  },
  {
    id: "rewrites",
    title: "Rewrites",
    emptyTitle: "No rewrites available",
    emptyDescription: "Saved instructions for reshaping selected text will appear here.",
  },
  {
    id: "instruct",
    title: "Instruct",
    emptyTitle: "No threads yet",
    emptyDescription: "Drafts written in Instruct Mode will be kept here for 30 days.",
  },
  {
    id: "scratchpad",
    title: "Scratchpad",
    emptyTitle: "The scratchpad is blank",
    emptyDescription: "A place to dictate and shape quick notes will open here.",
    feature: "scratchpad",
  },
  {
    id: "history",
    title: "History",
    emptyTitle: "No history yet",
    emptyDescription: "Every dictation will be kept here, with search and filters.",
  },
  {
    id: "my-voice",
    title: "My Voice",
    emptyTitle: "Nothing learned yet",
    emptyDescription: "How you write will be summarised here.",
  },
  {
    id: "memory",
    title: "Memory",
    emptyTitle: "Nothing remembered",
    emptyDescription: "Facts you want Murmur to know will be listed here.",
  },
  {
    id: "insights",
    title: "Insights",
    emptyTitle: "No insights yet",
    emptyDescription: "Usage summaries will be drawn here after some dictation.",
  },
  {
    id: "settings",
    title: "Settings",
    emptyTitle: "Settings are on the way",
    emptyDescription: "Preferences for dictation, privacy and appearance will be found here.",
  },
  {
    id: "help",
    title: "Help",
    emptyTitle: "Help is on the way",
    emptyDescription: "Guided tours and the app version will be found here.",
  },
] as const satisfies readonly {
  id: string;
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  feature?: PageFeature;
}[];

/** Switches that can hide a page. */
export type PageFeature = "scratchpad";

export type PageId = (typeof PAGES)[number]["id"];
export type Page = (typeof PAGES)[number];

/** Which features are on; a missing entry counts as on. */
export type PageFeatures = Partial<Record<PageFeature, boolean>>;

export function isPageId(value: string): value is PageId {
  return PAGES.some((page) => page.id === value);
}

/** The pages shown in the sidebar. */
export function visiblePages(features: PageFeatures): Page[] {
  return PAGES.filter((page) => !("feature" in page) || features[page.feature] !== false);
}

/** The page to show for a requested id: Home for an unknown or hidden page. */
export function resolvePage(id: string, features: PageFeatures): Page {
  return visiblePages(features).find((page) => page.id === id) ?? PAGES[0];
}

/** `#/history` → "history"; `#/settings/system` → "settings". */
export function pageFromHash(hash: string): string | null {
  const match = /^#\/([a-z-]+)(?:\/[a-z]+)?$/.exec(hash);
  return match ? match[1]! : null;
}
