import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { VStack } from "@astryxdesign/core/VStack";
import type { GmailThreadChoice } from "@murmur/shared";

const NONE = "";

/**
 * CN-04: puts a recent email thread into a meeting's notes, where the reply draft Skill reads
 * it. Gmail is asked only when the button is pressed.
 */
export function EmailThreadPicker({ onPick }: { onPick: (text: string) => void }) {
  const [on, setOn] = useState(false);
  const [threads, setThreads] = useState<GmailThreadChoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.murmur
      .getSettings()
      .then((view) => alive && setOn(view.settings.connectors.gmail.replyContext));
    return () => {
      alive = false;
    };
  }, []);

  if (!on) return null;

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await window.murmur.gmailThreads();
      if (!result.ok) setMessage(result.message);
      else if (result.threads.length === 0) setMessage("No thread from the last 30 days.");
      else setThreads(result.threads);
    } finally {
      setLoading(false);
    }
  }

  return (
    <VStack gap={1}>
      {threads ? (
        <Selector
          label="Email thread to reply to"
          value={NONE}
          options={[
            { value: NONE, label: "Choose a thread…" },
            ...threads.map((thread) => ({
              value: thread.id,
              label: `${thread.subject} · ${thread.from}`,
            })),
          ]}
          onChange={(id) => {
            const thread = threads.find((candidate) => candidate.id === id);
            if (!thread) return;
            onPick(thread.text);
            setThreads(null);
          }}
        />
      ) : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            label="Add an email thread to the notes"
            isDisabled={loading}
            onClick={() => void load()}
          >
            {loading ? "Reading…" : "Add an email thread"}
          </Button>
        </div>
      )}
      {message ? <Banner status="warning" title={message} /> : null}
    </VStack>
  );
}
