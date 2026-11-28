import { z } from "zod";

/**
 * Help (HB-08): short guided tours that point at parts of the Hub, and the local referrals
 * card (HB-43). Tour text is Murmur's own.
 */

export interface TourStep {
  /** The page to show: a Hub hash route. */
  hash: string;
  /** What to highlight: a CSS selector on that page. */
  target: string;
  title: string;
  text: string;
}

export interface Tour {
  id: string;
  title: string;
  summary: string;
  steps: TourStep[];
  /** Shown only while this experimental switch is on. */
  requires?: "commandMode";
}

const PAGE = ".hub-page h1";

export const TOURS: readonly Tour[] = [
  {
    id: "first-dictation",
    title: "Your first dictation",
    summary: "Hold a key, speak, let go.",
    steps: [
      {
        hash: "#/home",
        target: PAGE,
        title: "Home",
        text: "Home shows today's words and the key that starts a dictation.",
      },
      {
        hash: "#/settings/shortcuts",
        target: '[data-setting="hold"]',
        title: "Push to talk",
        text: "Hold this key in any app, say something like “Lunch at one works for me”, and let go. The text goes where the cursor is.",
      },
      {
        hash: "#/dictation",
        target: PAGE,
        title: "What the Bar shows",
        text: "While you hold the key the Bar listens; when you let go it works and then shows how many words went in. Recent dictations are listed here.",
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Shortcuts",
    summary: "Push to talk, hands-free, cancel and more.",
    steps: [
      {
        hash: "#/settings/shortcuts",
        target: '[data-setting="hold"]',
        title: "Push to talk",
        text: "Hold to dictate, let go to insert. Escape cancels a dictation.",
      },
      {
        hash: "#/settings/shortcuts",
        target: '[data-setting="hands-free"]',
        title: "Hands-free",
        text: "Starts dictation without holding a key; press again to stop. With none set, a double tap of the push-to-talk key does it.",
      },
      {
        hash: "#/settings/shortcuts",
        target: '[data-setting="rewrite"]',
        title: "Rewrite",
        text: "Select text anywhere and press this to reshape it with a Rewrite.",
      },
      {
        hash: "#/settings/shortcuts",
        target: '[data-setting="scratchpad-shortcut"]',
        title: "Scratchpad",
        text: "Opens the Scratchpad window for quick notes. The tray menu can copy or paste the last transcript.",
      },
    ],
  },
  {
    id: "cleanup",
    title: "Cleanup levels",
    summary: "How much Murmur tidies what you said.",
    steps: [
      {
        hash: "#/settings/system",
        target: '[data-setting="cleanup"]',
        title: "Cleanup",
        text: "Off keeps the words as heard. Light adds punctuation and capitals. Standard also drops fillers and keeps your corrections: “um meet at two, no, three” becomes “Meet at three.” Full also smooths long sentences.",
      },
    ],
  },
  {
    id: "dictionary-snippets",
    title: "Dictionary and Snippets",
    summary: "Names spelled right, and short phrases that expand.",
    steps: [
      {
        hash: "#/dictionary",
        target: PAGE,
        title: "Dictionary",
        text: "Add names and terms once and they are spelled right from then on. A replacement turns one word into another.",
      },
      {
        hash: "#/snippets",
        target: PAGE,
        title: "Snippets",
        text: "Say a trigger on its own, like “my address”, and the saved text goes in instead.",
      },
    ],
  },
  {
    id: "rewrites-commands",
    title: "Rewrites and Command Mode",
    summary: "Reshape text, and speak commands.",
    steps: [
      {
        hash: "#/rewrites",
        target: PAGE,
        title: "Rewrites",
        text: "Each Rewrite is an instruction for selected text, like Tighten or Clarify. Make your own here.",
      },
      {
        hash: "#/settings/experimental",
        target: '[data-setting="command-mode"]',
        title: "Command Mode",
        text: "Hold the Command Mode key and say what to do with the selection, like “make this a list”.",
      },
    ],
  },
];

/** The tours to offer: Command Mode's step only while that experiment is on. */
export function availableTours(commandMode: boolean): Tour[] {
  return TOURS.map((tour) =>
    tour.id === "rewrites-commands" && !commandMode
      ? { ...tour, steps: tour.steps.filter((step) => !step.target.includes("command-mode")) }
      : tour,
  );
}

export const helpSettingsSchema = z.strictObject({
  /** Where each tour got to; `done` once finished. */
  tours: z.record(z.string(), z.strictObject({ step: z.number().int().min(0), done: z.boolean() })),
  /** Whether a tour is offered the first time its page is opened. */
  offerTours: z.boolean().default(true),
});

/** The pages that have a tour of their own to offer on first use. */
const FIRST_USE: Readonly<Record<string, string>> = {
  home: "first-dictation",
  dictionary: "dictionary-snippets",
  snippets: "dictionary-snippets",
  rewrites: "rewrites-commands",
};

/** HB-08: the tour to offer on a page, or null: one not yet started, with offers on. */
export function tourToOffer(
  page: string,
  help: z.infer<typeof helpSettingsSchema>,
  commandMode: boolean,
): Tour | null {
  const id = FIRST_USE[page];
  if (!help.offerTours || !id || help.tours[id]) return null;
  return availableTours(commandMode).find((tour) => tour.id === id) ?? null;
}

/** HB-43: a code made here, and invitations counted by hand. Nothing is sent. */
export const referralSettingsSchema = z.strictObject({
  code: z.string().regex(/^([A-HJ-NP-Z2-9]{8})?$/),
  invites: z.number().int().min(0).max(10_000),
});

/** Letters and digits that cannot be mistaken for each other (no I, O, 0 or 1). */
export const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** An eight-character code from random bytes. */
export function referralCode(random: (count: number) => Uint8Array): string {
  return [...random(8)].map((byte) => REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length]).join("");
}
