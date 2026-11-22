import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  GMAIL_LIMITS,
  isEmailAddress,
  type EmailAutomationRecord,
  type EmailDraftProposal,
  type EmailDraftSource,
  type EmailDraftState,
} from "@murmur/shared";

const OTHER = "__other__";

/**
 * The words of the draft, as the owner can still change them. Everything is plain text: a link in
 * it is just characters here. Nothing is created until "Create the draft in Gmail" is clicked, and
 * even then it is only a draft, never a sent message.
 */
export function EmailDraftEditor({
  proposal,
  source,
  onDone,
  onCancel,
}: {
  proposal: EmailDraftProposal;
  source: EmailDraftSource;
  onDone: () => void;
  onCancel: () => void;
}) {
  const known = proposal.candidates.some((person) => person.email === proposal.to);
  const [pick, setPick] = useState(proposal.to === "" ? OTHER : known ? proposal.to : OTHER);
  const [typed, setTyped] = useState(known ? "" : proposal.to);
  const [subject, setSubject] = useState(proposal.subject);
  const [body, setBody] = useState(proposal.body);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const to = (pick === OTHER ? typed : pick).trim();

  async function create() {
    if (to !== "" && !isEmailAddress(to))
      return setMessage("Write one email address, or leave the recipient empty.");
    if (subject.trim() === "") return setMessage("Write a subject.");
    if (body.trim() === "") return setMessage("Write some text.");
    setMessage(null);
    setWorking(true);
    try {
      const result = await window.murmur.emailDraftCreate({
        source,
        accountId: proposal.accountId,
        to,
        subject: subject.trim(),
        body,
      });
      if (result.ok) onDone();
      else setMessage(result.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <VStack gap={2}>
      <Text size="sm" color="secondary">
        Check this before it goes to Gmail. It is created as a draft in {proposal.accountEmail}; it
        is never sent from Murmur.
      </Text>
      <HStack gap={2} align="end" wrap="wrap">
        <Selector
          label="To"
          value={pick}
          options={[
            ...proposal.candidates.map((person) => ({
              value: person.email,
              label: person.name ? `${person.name} (${person.email})` : person.email,
            })),
            { value: OTHER, label: "Another address, or nobody yet" },
          ]}
          onChange={setPick}
        />
        {pick === OTHER ? (
          <TextInput label="Address" value={typed} onChange={setTyped} placeholder="Optional" />
        ) : null}
      </HStack>
      <TextInput label="Subject" value={subject} onChange={setSubject} />
      <TextArea
        label="Text"
        description="Plain text. Links stay as typed text here."
        rows={8}
        value={body}
        onChange={(value) => setBody(value.slice(0, GMAIL_LIMITS.body))}
      />
      {message ? <Banner status="warning" title={message} /> : null}
      <HStack gap={2}>
        <Button
          variant="primary"
          label="Create the draft in Gmail"
          isDisabled={working}
          onClick={() => void create()}
        >
          {working ? "Creating…" : "Create the draft in Gmail"}
        </Button>
        <Button variant="secondary" label="Do not create a draft" onClick={onCancel}>
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}

/**
 * "Draft email" for a task or a meeting's summary (NT-27). It is switched off, with the reason
 * next to it, until Gmail is connected, drafting is turned on and the permission is given.
 */
export function EmailDraft({ source, label }: { source: EmailDraftSource; label?: string }) {
  const [state, setState] = useState<EmailDraftState | null>(null);
  const [drafts, setDrafts] = useState<EmailAutomationRecord[]>([]);
  const [proposal, setProposal] = useState<EmailDraftProposal | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The source is a new object on every render of the parent, so it is the kind and id that count.
  const { kind, id } = source;
  const load = useCallback(async () => {
    const [current, list] = await Promise.all([
      window.murmur.emailDraftState(),
      window.murmur.emailDraftList({ kind, id }),
    ]);
    setState(current);
    setDrafts(list);
  }, [kind, id]);

  useEffect(() => {
    void load().catch(() => setState({ available: false, reason: "Drafts could not be checked." }));
  }, [load]);

  async function start() {
    setMessage(null);
    setWorking(true);
    try {
      const result = await window.murmur.emailDraftPropose(source);
      if (result.ok) setProposal(result.proposal);
      else setMessage(result.message);
    } finally {
      setWorking(false);
    }
  }

  // Nothing to show until it is known; and a Mac without Gmail drafting shows no clutter, only
  // the disabled button and the reason.
  if (!state) return null;
  const name = label ?? "Draft email";
  // An action that is off, or whose account is not connected, is not offered (CN-12); drafts it
  // already made stay listed.
  const offered = state.hidden !== true;

  return (
    <VStack gap={1}>
      {offered ? (
        <HStack gap={2} align="center" wrap="wrap">
          <Button
            size="sm"
            variant="secondary"
            label={name}
            isDisabled={!state.available || working || proposal !== null}
            onClick={() => void start()}
          >
            {working ? "Writing…" : name}
          </Button>
          {!state.available && state.reason ? (
            <Text size="sm" color="secondary">
              {state.reason}
            </Text>
          ) : null}
        </HStack>
      ) : null}
      {message ? <Banner status="warning" title={message} /> : null}
      {proposal ? (
        <EmailDraftEditor
          proposal={proposal}
          source={source}
          onCancel={() => setProposal(null)}
          onDone={() => {
            setProposal(null);
            void load();
          }}
        />
      ) : null}
      {drafts.length > 0 ? (
        <ul className="hub-connector-list" aria-label="Drafts made">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <HStack gap={2} align="center" wrap="wrap">
                <Text size="sm">
                  Draft “{draft.subject}”{draft.to ? ` to ${draft.to}` : ""} is in Gmail.
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  label={`Open “${draft.subject}” in Gmail`}
                  onClick={() => void window.murmur.emailDraftOpen(draft.openUrl)}
                >
                  Open in Gmail
                </Button>
              </HStack>
            </li>
          ))}
        </ul>
      ) : null}
    </VStack>
  );
}
