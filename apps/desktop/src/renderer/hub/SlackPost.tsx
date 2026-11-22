import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import {
  SLACK_POST_LIMITS,
  type EmailDraftState,
  type SlackPostSource,
  type SlackPreview,
  type SlackStart,
} from "@murmur/shared";

/**
 * The message to Slack, written and then previewed (CN-05, CN-14). The preview shows the channel,
 * the exact text and every tag; nothing is sent until "Send to Slack" is clicked on it, and the
 * text cannot change after the preview, because sending takes only the preview.
 */
export function SlackComposer({
  source,
  start,
  onSent,
  onCancel,
}: {
  source: SlackPostSource;
  start: SlackStart;
  onSent: (channelLabel: string) => void;
  onCancel: () => void;
}) {
  const [channelId, setChannelId] = useState(start.channels[0]?.id ?? "");
  const [text, setText] = useState(start.text);
  const [preview, setPreview] = useState<SlackPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function show() {
    if (channelId === "") return setMessage("Choose a channel.");
    if (text.trim() === "") return setMessage("Write the message.");
    setMessage(null);
    setWorking(true);
    try {
      const result = await window.murmur.slackPostPrepare({ source, channelId, text });
      if (result.ok) setPreview(result.preview);
      else setMessage(result.message);
    } finally {
      setWorking(false);
    }
  }

  async function send() {
    if (!preview) return;
    setMessage(null);
    setWorking(true);
    try {
      const result = await window.murmur.slackPostSend({ token: preview.token });
      if (result.ok) onSent(result.channelLabel);
      else setMessage(result.message);
    } finally {
      setWorking(false);
    }
  }

  if (preview) {
    return (
      <VStack gap={2}>
        <Text weight="semibold">Check this before it is sent</Text>
        <Text size="sm" color="secondary">
          It will be posted to {preview.channelLabel} as you ({preview.accountEmail}).
        </Text>
        <div className="hub-brief" aria-label="The message that will be sent">
          <Text>
            <span style={{ whiteSpace: "pre-wrap" }}>{preview.shown}</span>
          </Text>
        </div>
        {preview.tags.length > 0 ? (
          <VStack gap={1}>
            <Text size="sm" weight="semibold">
              These people will be tagged and told:
            </Text>
            <ul className="hub-connector-list" aria-label="Tags">
              {preview.tags.map((tag) => (
                <li key={tag.userId}>
                  <Text size="sm">
                    {tag.mention} is {tag.name}
                  </Text>
                </li>
              ))}
            </ul>
          </VStack>
        ) : (
          <Text size="sm" color="secondary">
            {preview.taggingOn
              ? "No one will be tagged."
              : "No one will be tagged: tagging is off."}
          </Text>
        )}
        {preview.unresolved.length > 0 ? (
          <VStack gap={1}>
            <Text size="sm" weight="semibold">
              Sent as plain text, not tagged:
            </Text>
            <ul className="hub-connector-list" aria-label="Not tagged">
              {preview.unresolved.map((item) => (
                <li key={item.mention}>
                  <Text size="sm">
                    {item.mention}:{" "}
                    {item.reason === "several"
                      ? "more than one person has that name"
                      : "no one in Slack has that name"}
                  </Text>
                </li>
              ))}
            </ul>
          </VStack>
        ) : null}
        {message ? <Banner status="warning" title={message} /> : null}
        <HStack gap={2}>
          <Button
            variant="primary"
            label="Send this message to Slack"
            isDisabled={working}
            onClick={() => void send()}
          >
            {working ? "Sending…" : "Send it"}
          </Button>
          <Button
            variant="secondary"
            label="Change the message"
            isDisabled={working}
            onClick={() => setPreview(null)}
          >
            Change it
          </Button>
          <Button variant="ghost" label="Do not send" onClick={onCancel}>
            Cancel
          </Button>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack gap={2}>
      <Text size="sm" color="secondary">
        Write the message and choose the channel. You see exactly what will be sent before anything
        is.
      </Text>
      <Selector
        label="Channel"
        value={channelId}
        options={start.channels.map((channel) => ({ value: channel.id, label: channel.label }))}
        onChange={setChannelId}
      />
      <TextArea
        label="Message"
        description="Plain text. Write @name to mention someone when tagging is turned on."
        rows={6}
        value={text}
        onChange={(value) => setText(value.slice(0, SLACK_POST_LIMITS.text))}
      />
      {message ? <Banner status="warning" title={message} /> : null}
      <HStack gap={2}>
        <Button
          variant="primary"
          label="Preview the message"
          isDisabled={working}
          onClick={() => void show()}
        >
          {working ? "Checking…" : "Preview"}
        </Button>
        <Button variant="secondary" label="Do not send" onClick={onCancel}>
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}

/**
 * "Send to Slack" for a task or a meeting's summary (CN-05). It is left out when the action is off
 * or Slack is not connected, and shown with the reason when something else is missing.
 */
export function SlackPost({ source, label }: { source: SlackPostSource; label?: string }) {
  const [state, setState] = useState<EmailDraftState | null>(null);
  const [start, setStart] = useState<SlackStart | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    void window.murmur
      .slackPostState()
      .then(setState, () =>
        setState({ available: false, reason: "Slack could not be checked.", hidden: true }),
      );
  }, []);

  async function begin() {
    setMessage(null);
    setSent(null);
    setWorking(true);
    try {
      const result = await window.murmur.slackPostStart(source);
      if (result.ok) setStart(result.start);
      else setMessage(result.message);
    } finally {
      setWorking(false);
    }
  }

  if (!state || state.hidden === true) return null;
  const name = label ?? "Send to Slack";

  return (
    <VStack gap={1}>
      <HStack gap={2} align="center" wrap="wrap">
        <Button
          size="sm"
          variant="secondary"
          label={name}
          isDisabled={!state.available || working || start !== null}
          onClick={() => void begin()}
        >
          {working ? "Loading…" : name}
        </Button>
        {!state.available && state.reason ? (
          <Text size="sm" color="secondary">
            {state.reason}
          </Text>
        ) : null}
      </HStack>
      {message ? <Banner status="warning" title={message} /> : null}
      {sent ? <Banner status="success" title={`Sent to ${sent}.`} /> : null}
      {start ? (
        <SlackComposer
          source={source}
          start={start}
          onCancel={() => setStart(null)}
          onSent={(channel) => {
            setStart(null);
            setSent(channel);
          }}
        />
      ) : null}
    </VStack>
  );
}
