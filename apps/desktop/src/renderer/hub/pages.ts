export const PAGES = [
  {
    id: "home",
    title: "Home",
    emptyTitle: "Nothing to show yet",
    emptyDescription: "Your recent activity will gather here once dictation is switched on.",
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
    id: "memory",
    title: "Memory",
    emptyTitle: "Nothing remembered",
    emptyDescription: "Facts you want Murmur to know will be listed here.",
  },
  {
    id: "my-voice",
    title: "My Voice",
    emptyTitle: "Nothing learned yet",
    emptyDescription: "How you write will be summarised here.",
  },
  {
    id: "scratchpad",
    title: "Scratchpad",
    emptyTitle: "The scratchpad is blank",
    emptyDescription: "A place to dictate and shape quick notes will open here.",
  },
  {
    id: "notetaker",
    title: "Notetaker",
    emptyTitle: "No meeting notes",
    emptyDescription: "Notes from your meetings will be collected on this page.",
  },
  {
    id: "tasks",
    title: "Tasks",
    emptyTitle: "No tasks to follow up",
    emptyDescription: "Action items picked out of your notes will be tracked here.",
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
] as const;

export type PageId = (typeof PAGES)[number]["id"];
export type Page = (typeof PAGES)[number];
