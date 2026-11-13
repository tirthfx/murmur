// Plain data with no imports, so scripts run by Node directly can load it.

/**
 * Languages the user can choose (DC-17, DC-19). No choice means the language is detected.
 * `hi-Latn` is a profile, not a separate model: Hindi or English, written in Latin letters.
 */
export const SPEECH_LANGUAGES = [
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
  { code: "hi-Latn", label: "Mixed: Hindi in Latin script" },
] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number]["code"];
export const languageCodes = SPEECH_LANGUAGES.map((language) => language.code) as [
  SpeechLanguage,
  ...SpeechLanguage[],
];
