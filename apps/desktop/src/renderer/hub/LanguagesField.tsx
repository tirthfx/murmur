import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  MAX_LANGUAGES,
  SPEECH_LANGUAGES,
  languageLabel,
  type SpeechLanguage,
} from "@murmur/shared";

interface LanguagesFieldProps {
  languages: SpeechLanguage[];
  onChange: (languages: SpeechLanguage[]) => void;
}

/** Moves one item up by one place. */
export function moveUp<T>(list: readonly T[], index: number): T[] {
  if (index <= 0 || index >= list.length) return [...list];
  const next = [...list];
  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
  return next;
}

/**
 * Up to five languages in order (DC-19). The first is the primary and wins a tie when the
 * language is detected. None means the language is detected from all of them.
 */
export function LanguagesField({ languages, onChange }: LanguagesFieldProps) {
  const full = languages.length >= MAX_LANGUAGES;
  const available = SPEECH_LANGUAGES.filter((language) => !languages.includes(language.code));

  return (
    <VStack gap={2}>
      <VStack gap={0}>
        <Text weight="semibold">Languages</Text>
        <Text size="sm" color="secondary">
          {languages.length === 0
            ? "Detected automatically. Choose up to five to limit detection to them."
            : "The first is your primary language and wins when two are equally likely."}
        </Text>
      </VStack>
      {languages.length > 0 ? (
        <ol className="hub-language-list" data-testid="language-list">
          {languages.map((code, index) => (
            <li key={code}>
              <HStack gap={2} align="center" justify="between">
                <Text>
                  {languageLabel(code)}
                  {index === 0 ? " (primary)" : ""}
                </Text>
                <HStack gap={1}>
                  {index > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Move ${languageLabel(code)} up`}
                      onClick={() => onChange(moveUp(languages, index))}
                    >
                      Move up
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    label={`Remove ${languageLabel(code)}`}
                    onClick={() => onChange(languages.filter((item) => item !== code))}
                  >
                    Remove
                  </Button>
                </HStack>
              </HStack>
            </li>
          ))}
        </ol>
      ) : null}
      {full ? (
        <Text size="sm" color="secondary" role="status">
          You can choose at most five languages. Remove one to add another.
        </Text>
      ) : (
        <Selector
          label="Add a language"
          options={available.map((language) => ({ value: language.code, label: language.label }))}
          placeholder="Choose a language"
          onChange={(code) => onChange([...languages, code as SpeechLanguage])}
        />
      )}
    </VStack>
  );
}
