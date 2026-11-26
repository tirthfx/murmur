import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { readableMentions, type Contact, type ContactCard } from "@murmur/shared";

/** Contacts (NT-12): the list, one person's card, and adding, changing and deleting. */
export function ContactsPanel({ onOpenMeeting }: { onOpenMeeting: (meetingId: string) => void }) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [card, setCard] = useState<ContactCard | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fromCalendar, setFromCalendar] = useState<boolean | null>(null);

  const load = useCallback(() => window.murmur.contactsList(query).then(setContacts), [query]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void window.murmur
      .getSettings()
      .then((view) => setFromCalendar(view.settings.notetaker.contacts.fromCalendar));
  }, []);

  async function toggleFromCalendar(on: boolean) {
    const view = await window.murmur.getSettings();
    const next = await window.murmur.updateSettings({
      notetaker: { ...view.settings.notetaker, contacts: { fromCalendar: on } },
    });
    setFromCalendar(next.settings.notetaker.contacts.fromCalendar);
  }

  function clear() {
    setName("");
    setEmail("");
    setEditing(null);
  }

  async function save() {
    const result = await window.murmur.contactSave(editing, {
      name,
      email: email.trim() === "" ? null : email,
    });
    if (!result.ok) return setMessage(result.message);
    setMessage(null);
    clear();
    await load();
    if (card?.contact.id === result.contact.id) await open(result.contact.id);
  }

  async function open(id: string) {
    setConfirming(false);
    setCard(await window.murmur.contactCard(id));
  }

  async function remove(id: string) {
    if (!confirming) return setConfirming(true);
    await window.murmur.contactDelete(id);
    setCard(null);
    setConfirming(false);
    clear();
    await load();
  }

  return (
    <VStack gap={4}>
      <Text size="sm" color="secondary">
        People you can mention with @ in meeting notes, tasks and questions. Contacts stay on this
        computer.
      </Text>
      {fromCalendar !== null ? (
        <Switch
          label="Add the people invited to calendar meetings"
          value={fromCalendar}
          onChange={(on) => void toggleFromCalendar(on)}
        />
      ) : null}
      <VStack gap={2}>
        <Heading level={2}>{editing ? "Change the contact" : "Add a contact"}</Heading>
        <TextInput label="Name" value={name} onChange={setName} />
        <TextInput label="Email" value={email} onChange={setEmail} />
        {message ? <Banner status="warning" title={message} /> : null}
        <HStack gap={2}>
          <Button
            variant="primary"
            label={editing ? "Save the contact" : "Add the contact"}
            isDisabled={name.trim() === ""}
            onClick={() => void save()}
          >
            {editing ? "Save" : "Add contact"}
          </Button>
          {editing ? (
            <Button variant="secondary" label="Cancel the change" onClick={clear}>
              Cancel
            </Button>
          ) : null}
        </HStack>
      </VStack>
      <VStack gap={1}>
        <TextInput label="Search contacts" value={query} onChange={setQuery} />
        {contacts && contacts.length === 0 ? (
          <Text color="secondary">
            {query.trim() === "" ? "No contacts yet." : "No contact matches."}
          </Text>
        ) : null}
        <ul className="hub-dictionary-list" aria-label="Contacts">
          {(contacts ?? []).map((contact) => (
            <li key={contact.id}>
              <Button
                size="sm"
                variant="ghost"
                label={`Open ${contact.name}`}
                onClick={() => void open(contact.id)}
              >
                {contact.email ? `${contact.name} · ${contact.email}` : contact.name}
              </Button>
            </li>
          ))}
        </ul>
      </VStack>
      {card ? (
        <section aria-label={`Contact card of ${card.contact.name}`}>
          <VStack gap={2}>
            <Heading level={2}>{card.contact.name}</Heading>
            <Text color="secondary">{card.contact.email ?? "No email address"}</Text>
            <HStack gap={2}>
              <Button
                size="sm"
                variant="secondary"
                label={`Change ${card.contact.name}`}
                onClick={() => {
                  setEditing(card.contact.id);
                  setName(card.contact.name);
                  setEmail(card.contact.email ?? "");
                }}
              >
                Change
              </Button>
              <Button
                size="sm"
                variant={confirming ? "destructive" : "ghost"}
                label={`Delete ${card.contact.name}`}
                onClick={() => void remove(card.contact.id)}
              >
                {confirming ? "Delete (mentions become plain names)" : "Delete"}
              </Button>
            </HStack>
            <Heading level={3}>Meetings together</Heading>
            {card.meetings.length === 0 ? (
              <Text color="secondary">None yet.</Text>
            ) : (
              card.meetings.map((meeting) => (
                <Button
                  key={meeting.id}
                  size="sm"
                  variant="ghost"
                  label={`Open the meeting ${meeting.title}`}
                  onClick={() => onOpenMeeting(meeting.id)}
                >
                  {meeting.title} · {new Date(meeting.startedAt).toLocaleDateString()}
                </Button>
              ))
            )}
            <Heading level={3}>Open tasks</Heading>
            {card.tasks.length === 0 ? (
              <Text color="secondary">None.</Text>
            ) : (
              card.tasks.map((task) => <Text key={task.id}>{readableMentions(task.title)}</Text>)
            )}
          </VStack>
        </section>
      ) : null}
    </VStack>
  );
}
