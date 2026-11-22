import { useCallback, useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { TEAM_LIMITS, type TeamView } from "@murmur/shared";

const IDLE_CHOICES = [5, 15, 30, 60, 120];
const ROLE_TEXT: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
  viewer: "Viewer",
};

/** Connect: the address of a team server on this Mac or the local network. */
function ConnectForm({ onView }: { onView: (view: TeamView) => void }) {
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:7830");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.murmur.teamConnect({ serverUrl });
      if (result.ok) onView(result.view);
      else setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={2}>
      {message ? <Banner status="warning" title={message} /> : null}
      <HStack gap={2} align="end" wrap="wrap">
        <TextInput label="Team server address" value={serverUrl} onChange={setServerUrl} />
        <Button
          variant="primary"
          label="Connect to the team server"
          isDisabled={busy || serverUrl.trim() === ""}
          onClick={() => void connect()}
        >
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </HStack>
    </VStack>
  );
}

/** The first run on a new server makes the owner; after that people sign in. */
function SignInForms({ view, onView }: { view: TeamView; onView: (view: TeamView) => void }) {
  const setup = view.serverSetUp === false;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const result = setup
        ? await window.murmur.teamSetup({ name, email, password })
        : await window.murmur.teamSignIn({ email, password });
      if (result.ok) {
        setPassword("");
        onView(result.view);
      } else
        setMessage(
          result.retryAfterSeconds
            ? `${result.message} Try again in ${result.retryAfterSeconds} seconds.`
            : result.message,
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={2}>
      <Text color="secondary">
        {setup
          ? "This server has no owner yet. Make the owner account: the password needs at least 12 characters."
          : "Sign in with the account on this server."}
      </Text>
      {message ? <Banner status="warning" title={message} /> : null}
      {setup ? <TextInput label="Your name" value={name} onChange={setName} /> : null}
      <TextInput label="Email" value={email} onChange={setEmail} />
      <TextInput label="Password" type="password" value={password} onChange={setPassword} />
      <div>
        <Button
          variant="primary"
          label={setup ? "Create the owner account" : "Sign in"}
          isDisabled={
            busy || email.trim() === "" || password === "" || (setup && name.trim() === "")
          }
          onClick={() => void submit()}
        >
          {setup ? "Create the owner account" : "Sign in"}
        </Button>
      </div>
    </VStack>
  );
}

/** An invite code: joins a team, or asks to; with no account yet it makes one. */
function InviteForm({ view, onView }: { view: TeamView; onView: (view: TeamView) => void }) {
  const signedIn = view.state === "signed_in";
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.murmur.teamRedeem({
        code,
        ...(signedIn ? {} : { name, email, password }),
      });
      if (result.ok) {
        setCode("");
        setPassword("");
        setMessage(
          result.status === "pending"
            ? `Your request to join ${result.teamName} is waiting for an admin.`
            : `You joined ${result.teamName}.`,
        );
        onView(result.view);
      } else setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={2}>
      <Text weight="semibold">Use an invite</Text>
      {message ? <Banner status="info" title={message} /> : null}
      <TextInput label="Invite code" value={code} onChange={setCode} />
      {signedIn ? null : (
        <>
          <Text size="sm" color="secondary">
            With no account yet, the invite makes one.
          </Text>
          <TextInput label="Name for the new account" value={name} onChange={setName} />
          <TextInput label="Email for the new account" value={email} onChange={setEmail} />
          <TextInput
            label="Password for the new account"
            type="password"
            value={password}
            onChange={setPassword}
          />
        </>
      )}
      <div>
        <Button
          variant="secondary"
          label="Use the invite"
          isDisabled={busy || code.trim() === ""}
          onClick={() => void redeem()}
        >
          Use the invite
        </Button>
      </div>
    </VStack>
  );
}

const when = (at: number) => new Date(at).toLocaleString();

/**
 * Team mode (TM-01, TM-06): connect to a team server, sign in, see your teams, and keep the
 * team's shared dictionary and snippets in step. It is off until you connect. Your own entries
 * always come first, and leaving a team never touches your own meetings.
 */
export function TeamPage() {
  const [view, setView] = useState<TeamView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await window.murmur.teamView());
    } catch {
      setMessage("Team mode could not be read.");
    }
  }, []);

  useEffect(() => {
    void load();
    return window.murmur.onTeamChanged(setView);
  }, [load]);

  if (!view) return message ? <Banner status="error" title={message} /> : <Text>Loading…</Text>;

  const idleChoices = [...new Set([...IDLE_CHOICES, view.idleLockMinutes])].sort((a, b) => a - b);

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Team mode lets Murmur use a team server: the team&apos;s shared dictionary and snippets, and
        a usage count (numbers only, never text) for the team&apos;s dashboard. It is off until you
        connect to a server on this Mac or your network. What you dictate and record stays on this
        Mac.
      </Text>

      {!view.enabled ? <ConnectForm onView={setView} /> : null}

      {view.enabled ? (
        <VStack gap={2}>
          <HStack gap={2} align="center" wrap="wrap">
            <Text weight="semibold">{view.serverUrl.replace(/\/$/, "")}</Text>
            <Badge
              variant={view.state === "signed_in" ? "success" : "neutral"}
              label={
                view.state === "signed_in"
                  ? "Signed in"
                  : view.state === "locked"
                    ? "Locked"
                    : "Not signed in"
              }
            />
          </HStack>
          {view.syncProblem ? <Banner status="warning" title={view.syncProblem} /> : null}
        </VStack>
      ) : null}

      {view.enabled && view.state === "signed_out" ? (
        <>
          <SignInForms view={view} onView={setView} />
          <InviteForm view={view} onView={setView} />
        </>
      ) : null}

      {view.state === "signed_in" || view.state === "locked" ? (
        <VStack gap={3}>
          <Text>
            Signed in as {view.user?.name} ({view.user?.email}).
          </Text>

          {view.notices.length > 0 ? (
            <VStack gap={1}>
              <Banner
                status="info"
                title={`${view.notices.length === 1 ? "A proposal was" : `${view.notices.length} proposals were`} turned down`}
              />
              <ul className="hub-connector-list" aria-label="Proposals turned down">
                {view.notices.map((notice) => (
                  <li key={notice.id}>
                    <Text size="sm">
                      “{notice.summary}”{notice.note ? `: ${notice.note}` : ""}
                    </Text>
                  </li>
                ))}
              </ul>
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Dismiss the notices"
                  onClick={() => void window.murmur.teamNoticesSeen()}
                >
                  Dismiss
                </Button>
              </div>
            </VStack>
          ) : null}

          <VStack gap={1}>
            <Text weight="semibold">Your teams</Text>
            {view.teams.length === 0 ? (
              <Text size="sm" color="secondary">
                You are not in a team yet. Use an invite below.
              </Text>
            ) : (
              <ul className="hub-connector-list" aria-label="Your teams">
                {view.teams.map((team) => (
                  <li key={team.id}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text size="sm">{team.name}</Text>
                      <Badge variant="neutral" label={ROLE_TEXT[team.myRole] ?? team.myRole} />
                    </HStack>
                  </li>
                ))}
              </ul>
            )}
          </VStack>

          <Text size="sm" color="secondary">
            Shared with you now: {view.sharedCounts.dictionary} dictionary{" "}
            {view.sharedCounts.dictionary === 1 ? "entry" : "entries"} and{" "}
            {view.sharedCounts.snippets} {view.sharedCounts.snippets === 1 ? "snippet" : "snippets"}
            . {view.lastSyncAt ? `Last updated ${when(view.lastSyncAt)}.` : "Not updated yet."} Your
            own entries are used first.
          </Text>

          <HStack gap={2} wrap="wrap">
            <Button
              size="sm"
              variant="secondary"
              label="Update the shared entries now"
              onClick={() => void window.murmur.teamSyncNow()}
            >
              Update now
            </Button>
            <Button
              size="sm"
              variant="secondary"
              label="Lock Murmur now"
              onClick={() => void window.murmur.teamLock()}
            >
              Lock now
            </Button>
            <Button
              size="sm"
              variant="secondary"
              label="Sign out of the team server"
              onClick={() => void window.murmur.teamSignOut()}
            >
              Sign out
            </Button>
          </HStack>

          <Selector
            label="Lock Murmur when the Mac has been idle for"
            description="Meetings and notes are hidden until you enter your password."
            value={String(view.idleLockMinutes)}
            options={idleChoices.map((minutes) => ({
              value: String(minutes),
              label: minutes === 1 ? "1 minute" : `${minutes} minutes`,
            }))}
            onChange={(value) => void window.murmur.teamSetIdleLock(Number(value))}
          />
          <Text size="sm" color="secondary">
            Between {TEAM_LIMITS.idleLockMinutes.min} and {TEAM_LIMITS.idleLockMinutes.max} minutes.
          </Text>

          <InviteForm view={view} onView={setView} />
        </VStack>
      ) : null}

      {view.enabled ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            label="Turn off team mode"
            onClick={() => void window.murmur.teamDisconnect()}
          >
            Turn off team mode
          </Button>
        </div>
      ) : null}
    </VStack>
  );
}
