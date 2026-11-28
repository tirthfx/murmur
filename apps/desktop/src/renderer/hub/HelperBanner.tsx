import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import type { HelperStatus } from "@murmur/shared";

const POLL_INTERVAL_MS = 2000;

/** Shown on every page when the helper was given up on, with a way to try again. */
export function HelperBanner() {
  const [status, setStatus] = useState<HelperStatus | null>(null);
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      window.murmur
        .getHelperStatus()
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (status?.state !== "error" && status?.state !== "unavailable") return null;

  async function retry() {
    setTrying(true);
    try {
      await window.murmur.helperRetry();
      setStatus(await window.murmur.getHelperStatus());
    } finally {
      setTrying(false);
    }
  }

  return (
    <Banner
      status="error"
      title="Dictation is off: Murmur's helper is not running"
      description={status.message ?? undefined}
      endContent={
        <Button
          size="sm"
          variant="secondary"
          label="Start the helper again"
          isDisabled={trying}
          onClick={() => void retry()}
        >
          Retry
        </Button>
      }
    />
  );
}
