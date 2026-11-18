import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { NoteSummary } from "@murmur/shared";

/** The Hub's Scratchpad page (HB-26): opens the Scratchpad window, or a recent note in it. */
export function ScratchpadPage() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);

  useEffect(() => {
    void window.murmur.notesList("").then(
      (list) => setNotes(list.slice(0, 10)),
      () => {},
    );
  }, []);

  return (
    <VStack gap={3}>
      <Text color="secondary">
        Scratchpad is a place for free writing, in its own window. Notes stay on this Mac and save
        as you type. Dictation works in a note like in any other app.
      </Text>
      <HStack gap={2}>
        <Button label="Open the Scratchpad" onClick={() => void window.murmur.scratchpadOpen(null)}>
          Open Scratchpad
        </Button>
      </HStack>
      {notes.length > 0 ? (
        <VStack gap={1}>
          <Text weight="semibold">Recent notes</Text>
          <ul className="hub-history-list" aria-label="Recent notes">
            {notes.map((note) => (
              <li key={note.id}>
                <Button
                  variant="ghost"
                  label={`Open the note ${note.title}`}
                  onClick={() => void window.murmur.scratchpadOpen(note.id)}
                >
                  {note.title}
                </Button>
              </li>
            ))}
          </ul>
        </VStack>
      ) : null}
    </VStack>
  );
}
