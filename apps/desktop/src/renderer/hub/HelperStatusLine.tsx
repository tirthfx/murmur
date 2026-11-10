import { useEffect, useState } from "react";
import { Text } from "@astryxdesign/core/Text";
import type { HelperStatus } from "@murmur/shared";
import { describeHelperStatus } from "./helper-status";

const POLL_INTERVAL_MS = 2000;

/** Shows the helper's state as one line, refreshed while it is on screen. */
export function HelperStatusLine() {
  const [status, setStatus] = useState<HelperStatus | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      window.murmur
        .getHelperStatus()
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch(() => {
          // Keep the last known status; the next poll may succeed.
        });
    };
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Text size="sm" color="secondary" data-testid="helper-status">
      {status ? describeHelperStatus(status) : "Helper: checking"}
    </Text>
  );
}
