import {
  MAX_LANGUAGES,
  type Settings,
  SPEECH_LANGUAGES,
  type SpeechLanguage,
  type Transcript,
} from "@murmur/shared";
import { languagesFor } from "../settings/settings-service";

/** The detector must be surer than this (DC-17). */
export const LANGUAGE_PROMPT_CONFIDENCE = 0.85;
/** So many dictations in a row before the question. */
export const LANGUAGE_PROMPT_SESSIONS = 2;
/** "Not now" keeps quiet about that language this long. */
export const LANGUAGE_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export interface LanguagePromptDeps {
  settings(): Settings;
  save(patch: Pick<Settings, "languagePrompt"> | Pick<Settings, "languages">): void;
  now(): number;
}

export interface LanguagePrompt {
  /**
   * Hears what was detected in one dictation; nothing when no detection ran. Returns a
   * language to offer to add, or null.
   */
  heard(detected: Transcript["heard"]): SpeechLanguage | null;
  /** The answer to the offer. Without one, nothing changes. */
  add(language: SpeechLanguage): void;
  notNow(language: SpeechLanguage): void;
}

/**
 * Offers to add a language that is spoken but not chosen (DC-17): only while the language is
 * being detected among two or more chosen ones, and only when there is room for another.
 */
export function createLanguagePrompt(deps: LanguagePromptDeps): LanguagePrompt {
  let streak: { language: SpeechLanguage; count: number } | null = null;

  function candidate(detected: Transcript["heard"]): SpeechLanguage | null {
    const settings = deps.settings();
    if (!detected || detected.confidence <= LANGUAGE_PROMPT_CONFIDENCE) return null;
    if (!settings.languagePrompt.enabled || settings.languages.length >= MAX_LANGUAGES) return null;
    const language = SPEECH_LANGUAGES.find((item) => item.code === detected.language)?.code;
    if (!language || languagesFor(settings).includes(language)) return null;
    const until = settings.languagePrompt.snoozed[language] ?? 0;
    return until > deps.now() ? null : language;
  }

  return {
    heard(detected) {
      const language = candidate(detected);
      if (!language) {
        streak = null;
        return null;
      }
      const count = streak?.language === language ? streak.count + 1 : 1;
      streak = count < LANGUAGE_PROMPT_SESSIONS ? { language, count } : null;
      return streak ? null : language;
    },
    add(language) {
      const { languages } = deps.settings();
      if (languages.includes(language) || languages.length >= MAX_LANGUAGES) return;
      deps.save({ languages: [...languages, language] });
    },
    notNow(language) {
      const { languagePrompt } = deps.settings();
      const now = deps.now();
      const snoozed = Object.fromEntries(
        Object.entries(languagePrompt.snoozed).filter(([, until]) => until > now),
      );
      deps.save({
        languagePrompt: {
          ...languagePrompt,
          snoozed: { ...snoozed, [language]: now + LANGUAGE_PROMPT_SNOOZE_MS },
        },
      });
    },
  };
}
