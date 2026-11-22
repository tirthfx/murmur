import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  CREATE_EVENT_LIMITS,
  EVENT_DURATIONS,
  type CalendarEventProposal,
  type CalendarEventRecord,
  type CalendarEventSource,
  type CalendarEventState,
} from "@murmur/shared";

const pad = (n: number) => String(n).padStart(2, "0");
const dayText = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const clockText = (ms: number) => {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** A date `YYYY-MM-DD` and a time `HH:MM` here, as milliseconds; null when either is not real. */
export function parseStart(day: string, clock: string): number | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  const time = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!date || !time) return null;
  const [y, m, d, h, min] = [date[1], date[2], date[3], time[1], time[2]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const at = new Date(y, m - 1, d, h, min);
  const real =
    at.getFullYear() === y &&
    at.getMonth() === m - 1 &&
    at.getDate() === d &&
    at.getHours() === h &&
    at.getMinutes() === min;
  return real ? at.getTime() : null;
}

const whenText = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The event as the owner can still change it. Nothing is created until "Create the event" is
 * clicked. People are added to the event, but they are told only when invitations are allowed in
 * Settings and the box here is ticked as well.
 */
function Editor({
  proposal,
  source,
  onDone,
  onCancel,
}: {
  proposal: CalendarEventProposal;
  source: CalendarEventSource;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(proposal.title);
  const [day, setDay] = useState(dayText(proposal.startMs));
  const [clock, setClock] = useState(clockText(proposal.startMs));
  const [minutes, setMinutes] = useState(proposal.durationMinutes);
  const [description, setDescription] = useState(proposal.description);
  const [added, setAdded] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [invite, setInvite] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const people = [...added, ...(extra.trim() === "" ? [] : [extra.trim()])];
  const durations = [...new Set<number>([...EVENT_DURATIONS, proposal.durationMinutes])].sort(
    (a, b) => a - b,
  );

  async function create() {
    const startMs = parseStart(day, clock);
    if (title.trim() === "") return setMessage("Write a title.");
    if (startMs === null)
      return setMessage("Write the date as YYYY-MM-DD and the time as HH:MM, for example 14:30.");
    setMessage(null);
    setWorking(true);
    try {
      const result = await window.murmur.calendarEventCreate({
        source,
        accountId: proposal.accountId,
        title: title.trim(),
        startMs,
        durationMinutes: minutes,
        attendees: people,
        description,
        sendInvites: proposal.invitesAllowed && invite && people.length > 0,
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
        Check this before it goes to your calendar ({proposal.accountEmail}). Nothing is created
        until you click Create the event.
      </Text>
      <TextInput label="Title" value={title} onChange={setTitle} />
      <HStack gap={2} align="end" wrap="wrap">
        <TextInput label="Date" placeholder="YYYY-MM-DD" value={day} onChange={setDay} />
        <TextInput label="Start time" placeholder="HH:MM" value={clock} onChange={setClock} />
        <Selector
          label="Length"
          value={String(minutes)}
          options={durations.map((value) => ({ value: String(value), label: `${value} minutes` }))}
          onChange={(value) => setMinutes(Number(value))}
        />
      </HStack>
      {proposal.candidates.length > 0 ? (
        <VStack gap={1}>
          <Text size="sm" weight="semibold">
            People from the meeting
          </Text>
          {proposal.candidates.map((person) => (
            <Switch
              key={person.email}
              label={`Add ${person.name ? `${person.name} (${person.email})` : person.email}`}
              value={added.includes(person.email)}
              onChange={(on) =>
                setAdded((list) =>
                  on ? [...list, person.email] : list.filter((email) => email !== person.email),
                )
              }
            />
          ))}
        </VStack>
      ) : null}
      <TextInput
        label="Another person to add"
        placeholder="Optional email address"
        value={extra}
        onChange={setExtra}
      />
      {people.length > 0 ? (
        proposal.invitesAllowed ? (
          <Switch
            label="Send invitations to the people added"
            description="Off: they are on the event but nobody is told."
            value={invite}
            onChange={setInvite}
          />
        ) : (
          <Text size="sm" color="secondary">
            {proposal.connector === "outlookCalendar"
              ? "The people are named in the event's text. Nobody is told: invitations are off in Settings."
              : "The people are listed on the event. Nobody is told: invitations are off in Settings."}
          </Text>
        )
      ) : null}
      <TextArea
        label="Description"
        rows={4}
        value={description}
        onChange={(value) => setDescription(value.slice(0, CREATE_EVENT_LIMITS.description))}
      />
      {message ? <Banner status="warning" title={message} /> : null}
      <HStack gap={2}>
        <Button
          variant="primary"
          label="Create the event"
          isDisabled={working}
          onClick={() => void create()}
        >
          {working ? "Creating…" : "Create the event"}
        </Button>
        <Button variant="secondary" label="Do not create an event" onClick={onCancel}>
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}

/**
 * "Create event" for a task or a meeting (NT-28). Switched off, with the reason next to it, until
 * a calendar is connected, its read-only switch is off and the write permission is given.
 */
export function CalendarEventCreate({
  source,
  label,
}: {
  source: CalendarEventSource;
  label?: string;
}) {
  const [state, setState] = useState<CalendarEventState | null>(null);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [proposal, setProposal] = useState<CalendarEventProposal | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The source is a new object on every render of the parent, so it is the kind and id that count.
  const { kind, id } = source;
  const load = useCallback(async () => {
    const [current, list] = await Promise.all([
      window.murmur.calendarEventState(),
      window.murmur.calendarEventList({ kind, id }),
    ]);
    setState(current);
    setEvents(list);
  }, [kind, id]);

  useEffect(() => {
    void load().catch(() => setState({ available: false, reason: "Events could not be checked." }));
  }, [load]);

  async function start() {
    setMessage(null);
    setWorking(true);
    try {
      const result = await window.murmur.calendarEventPropose(source);
      if (result.ok) setProposal(result.proposal);
      else setMessage(result.message);
    } finally {
      setWorking(false);
    }
  }

  if (!state) return null;
  const name = label ?? "Create event";

  return (
    <VStack gap={1}>
      <HStack gap={2} align="center" wrap="wrap">
        <Button
          size="sm"
          variant="secondary"
          label={name}
          isDisabled={!state.available || working || proposal !== null}
          onClick={() => void start()}
        >
          {name}
        </Button>
        {!state.available && state.reason ? (
          <Text size="sm" color="secondary">
            {state.reason}
          </Text>
        ) : null}
      </HStack>
      {message ? <Banner status="warning" title={message} /> : null}
      {proposal ? (
        <Editor
          proposal={proposal}
          source={source}
          onCancel={() => setProposal(null)}
          onDone={() => {
            setProposal(null);
            void load();
          }}
        />
      ) : null}
      {events.length > 0 ? (
        <ul className="hub-connector-list" aria-label="Events made">
          {events.map((event) => (
            <li key={event.id}>
              <HStack gap={2} align="center" wrap="wrap">
                <Text size="sm">
                  Event “{event.title}” on {whenText(event.startMs)} is in your calendar.
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  label={`Open “${event.title}” in your calendar`}
                  onClick={() => void window.murmur.calendarEventOpen(event.openUrl)}
                >
                  Open in calendar
                </Button>
              </HStack>
            </li>
          ))}
        </ul>
      ) : null}
    </VStack>
  );
}
