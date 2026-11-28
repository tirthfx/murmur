import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { describeEmailStyle, type GmailSettings } from "@murmur/shared";

/** What reads Gmail only when asked: reply threads, contacts and how email is written. */
export function GmailMailSection({
  gmail,
  save,
  onLearned,
}: {
  gmail: GmailSettings;
  save: (patch: Partial<GmailSettings>) => Promise<void>;
  /** The saved settings changed in main: read them again. */
  onLearned: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await work());
    } finally {
      setBusy(false);
    }
  }

  const importContacts = () =>
    run(async () => {
      const result = await window.murmur.gmailImportContacts();
      if (!result.ok) return result.message;
      return `Added ${result.added} of ${result.found} people you wrote to; the rest were contacts already.`;
    });

  const learn = () =>
    run(async () => {
      const result = await window.murmur.gmailLearnStyle();
      if (!result.ok) return result.message;
      await onLearned();
      return `Learned from ${result.style.messages} sent messages.`;
    });

  return (
    <VStack gap={2}>
      <Switch
        label="Reply from an email thread"
        description="In a meeting's notes you can add a recent thread, then draft a reply with the Email reply draft Skill."
        value={gmail.replyContext}
        onChange={(replyContext) => void save({ replyContext })}
      />
      <Switch
        label="Add people I write to as contacts"
        description="When you ask, Murmur reads the addresses on mail you sent in the last 90 days. No message text is read."
        value={gmail.contactsFromMail}
        onChange={(contactsFromMail) => void save({ contactsFromMail })}
      />
      {gmail.contactsFromMail ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            label="Add people from sent mail now"
            isDisabled={busy}
            onClick={() => void importContacts()}
          >
            Add them now
          </Button>
        </div>
      ) : null}
      <Switch
        label="Learn how I write email"
        description="When you ask, Murmur reads up to 50 messages you sent and works out your opening, sign-off and usual length on this Mac. Instruct Mode uses it in email apps. Turning this off forgets it."
        value={gmail.learnStyle}
        onChange={(learnStyle) =>
          void save(learnStyle ? { learnStyle } : { learnStyle, style: null })
        }
      />
      {gmail.learnStyle ? (
        <VStack gap={1}>
          {gmail.style ? (
            <Text size="sm" color="secondary">
              {describeEmailStyle(gmail.style)}
            </Text>
          ) : null}
          <div>
            <Button
              size="sm"
              variant="secondary"
              label="Learn from sent mail now"
              isDisabled={busy}
              onClick={() => void learn()}
            >
              {gmail.style ? "Learn again" : "Learn from sent mail"}
            </Button>
          </div>
        </VStack>
      ) : null}
      {message ? (
        <Text size="sm" role="status">
          {message}
        </Text>
      ) : null}
    </VStack>
  );
}
