import { useEffect, useState, type SyntheticEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { CONTACT_LIMITS, mentionQuery, mentionToken, type Contact } from "@murmur/shared";

interface MentionFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** A text area with this many rows, or one line when not given. */
  rows?: number;
  description?: string;
  maxLength?: number;
  onBlur?: () => void;
}

/**
 * A text box where "@" offers contacts (NT-12). Choosing one writes a mention; a name nobody
 * has can be made a contact from here.
 */
export function MentionField({ rows, value, onChange, onBlur, ...field }: MentionFieldProps) {
  const [typed, setTyped] = useState<{ start: number; end: number; query: string } | null>(null);
  const [matches, setMatches] = useState<Contact[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const query = typed?.query ?? null;

  useEffect(() => {
    if (query === null) return;
    let alive = true;
    void window.murmur.contactsList(query).then((found) => {
      if (alive) setMatches(found.slice(0, CONTACT_LIMITS.suggestions));
    });
    return () => {
      alive = false;
    };
  }, [query]);

  /** Reads the "@name" at the caret of the box that changed. */
  function watch(event: SyntheticEvent) {
    const box = event.target as Partial<HTMLTextAreaElement>;
    if (typeof box.value !== "string") return;
    const caret = box.selectionStart ?? box.value.length;
    const found = mentionQuery(box.value, caret);
    setTyped(found ? { ...found, end: caret } : null);
    setProblem(null);
  }

  function insert(contact: Contact) {
    if (!typed) return;
    onChange(`${value.slice(0, typed.start)}${mentionToken(contact)} ${value.slice(typed.end)}`);
    setTyped(null);
  }

  async function create(name: string) {
    const result = await window.murmur.contactSave(null, { name, email: null });
    if (result.ok) insert(result.contact);
    else setProblem(result.message);
  }

  const name = typed?.query.trim() ?? "";
  const known = matches.some((contact) => contact.name.toLowerCase() === name.toLowerCase());

  return (
    <VStack gap={1}>
      <div
        onInput={watch}
        onKeyUp={(event) => {
          if (event.key === "Escape") setTyped(null);
          else if (event.key.startsWith("Arrow")) watch(event);
        }}
        onBlur={onBlur}
      >
        {rows ? (
          <TextArea {...field} rows={rows} value={value} onChange={onChange} />
        ) : (
          <TextInput {...field} value={value} onChange={onChange} />
        )}
      </div>
      {typed ? (
        <div role="group" aria-label="Mention a contact">
          <VStack gap={0}>
            {matches.map((contact) => (
              <Button
                key={contact.id}
                size="sm"
                variant="ghost"
                label={`Mention ${contact.name}`}
                onClick={() => insert(contact)}
              >
                {contact.email ? `${contact.name} · ${contact.email}` : contact.name}
              </Button>
            ))}
            {name !== "" && !known ? (
              <Button
                size="sm"
                variant="secondary"
                label={`Create contact ${name}`}
                onClick={() => void create(name)}
              >
                Create contact “{name}”
              </Button>
            ) : matches.length === 0 ? (
              <Text size="sm" color="secondary">
                Type a name to find or add a contact.
              </Text>
            ) : null}
            {problem ? (
              <Text size="sm" role="alert">
                {problem}
              </Text>
            ) : null}
          </VStack>
        </div>
      ) : null}
    </VStack>
  );
}
