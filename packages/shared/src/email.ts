import { z } from "zod";

// Email (PZ-20 to PZ-23): the signature, the email language and writing samples. The
// signature rules are pure and shared, so the Hub's preview matches a dictation.

export const EMAIL_LIMITS = {
  signatureChars: 500,
  samples: 10,
  /** Per sample, in UTF-8 bytes. */
  sampleBytes: 20 * 1024,
  labelChars: 80,
  /** The translation's own time limit, apart from the cleanup budget (PZ-22). */
  translateMs: 6_000,
} as const;

/**
 * Languages email can be written in: the dictation languages, without the mixed Hindi profile
 * (it is a way of writing Hindi, not a language to translate into).
 */
export const EMAIL_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "bn", label: "Bengali" },
  { code: "ur", label: "Urdu" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
] as const;
export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number]["code"];
const emailLanguageCodes = EMAIL_LANGUAGES.map((language) => language.code) as [
  EmailLanguage,
  ...EmailLanguage[],
];

export function emailLanguageLabel(code: EmailLanguage): string {
  return EMAIL_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

export const emailSettingsSchema = z.strictObject({
  /** Plain text, line breaks allowed. Empty means no signature. */
  signature: z.string().max(EMAIL_LIMITS.signatureChars),
  addToNew: z.boolean(),
  addToReplies: z.boolean(),
  /** Null: the same as dictation, so nothing is translated. */
  language: z.enum(emailLanguageCodes).nullable(),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export const DEFAULT_EMAIL: EmailSettings = {
  signature: "",
  addToNew: true,
  addToReplies: false,
  language: null,
};

/** A reply, judged by the window title: "Re: Lunch", "RE[2]: Lunch", "Re : Lunch". */
export function isReplyTitle(title: string | null): boolean {
  return title !== null && /^\s*re\s*(\[\d+\])?\s*:/i.test(title);
}

const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s.,;:!?–—-]+/g, " ")
    .trim();

/**
 * The body with the signature after a blank line (PZ-21). Unchanged when there is no
 * signature, no body, or the body already ends with the signature (the owner said it).
 */
export function withSignature(body: string, signature: string): string {
  const sig = signature.trim();
  const text = body.trimEnd();
  if (sig === "" || text === "") return body;
  const wanted = comparable(sig);
  if (wanted !== "" && comparable(text).endsWith(wanted)) return body;
  return `${text}\n\n${sig}`;
}

/** Whether a dictation in the Email category gets the signature, by the settings. */
export function wantsSignature(settings: EmailSettings, windowTitle: string | null): boolean {
  if (settings.signature.trim() === "") return false;
  return isReplyTitle(windowTitle) ? settings.addToReplies : settings.addToNew;
}

// Writing samples (PZ-20): kept for Rewrites (M3), shown on the Styles page.

export const writingSampleSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string(),
  text: z.string(),
  /** UTF-8 size of the text. */
  bytes: z.number().int().min(0),
  createdAt: z.number().int(),
});
export type WritingSample = z.infer<typeof writingSampleSchema>;

export const writingSampleInputSchema = z.strictObject({
  label: z.string().max(EMAIL_LIMITS.labelChars + 20),
  // Characters, generously; the byte limit is checked in main.
  text: z.string().max(EMAIL_LIMITS.sampleBytes * 2),
});
export type WritingSampleInput = z.infer<typeof writingSampleInputSchema>;

export const writingSampleSaveResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), sample: writingSampleSchema }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["empty", "too-large", "full", "no-label"]),
    message: z.string(),
  }),
]);
export type WritingSampleSaveResult = z.infer<typeof writingSampleSaveResultSchema>;

/** "20 KB" for the limit; one decimal under 10 KB, and "under 1 KB" below that. */
export function formatKb(bytes: number): string {
  if (bytes < 1024) return "under 1 KB";
  const kb = bytes / 1024;
  return `${kb < 10 ? Math.round(kb * 10) / 10 : Math.round(kb)} KB`;
}
