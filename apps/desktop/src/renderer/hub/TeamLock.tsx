import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { TEAM_MESSAGES } from "@murmur/shared";

/**
 * Shown in place of the page while Murmur is locked (TM-01): after the Mac has been idle for the
 * time the owner chose, nothing about meetings is on screen until the password is entered. The
 * server checks the password; a few wrong ones in a row make it wait.
 */
export function TeamLock() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.murmur.teamUnlock(password);
      if (!result.ok)
        setMessage(
          result.retryAfterSeconds
            ? `${result.message} Try again in ${result.retryAfterSeconds} seconds.`
            : result.message,
        );
      else setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={3} role="dialog" aria-modal="true" aria-label="Murmur is locked">
      <Text>{TEAM_MESSAGES.locked}</Text>
      {message ? <Banner status="warning" title={message} /> : null}
      <TextInput
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        onKeyDown={(event) => {
          if (event.key === "Enter" && password !== "" && !busy) void unlock();
        }}
      />
      <div>
        <Button
          variant="primary"
          label="Unlock Murmur"
          isDisabled={busy || password === ""}
          onClick={() => void unlock()}
        >
          Unlock
        </Button>
      </div>
    </VStack>
  );
}
