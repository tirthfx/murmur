import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import type { TeamProposeInput, TeamView } from "@murmur/shared";

/** The team connection, kept up to date, or null until it is known. */
export function useTeamView(): TeamView | null {
  const [view, setView] = useState<TeamView | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.resolve(window.murmur.teamView?.()).then(
      (next) => active && next && setView(next),
      () => undefined,
    );
    const off = window.murmur.onTeamChanged?.((next) => setView(next));
    return () => {
      active = false;
      off?.();
    };
  }, []);
  return view;
}

/**
 * "Share with the team" for one entry (TM-06, TM-07). It is shown only while signed in to a
 * team. The server decides: an entry goes live at once, waits for a review, or is refused, and the
 * words say which. The entry itself stays in the person's own list either way.
 */
export function ShareWithTeam({ name, input }: { name: string; input: TeamProposeInput }) {
  const view = useTeamView();
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  if (!view || view.state !== "signed_in" || view.teams.length === 0) return null;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        label={`Share ${name} with the team`}
        isDisabled={busy}
        onClick={async () => {
          setBusy(true);
          setSaid("");
          try {
            const result = await window.murmur.teamPropose(input);
            setSaid(
              !result.ok
                ? result.message
                : result.status === "live"
                  ? `Shared with ${result.teamName}.`
                  : `Sent to ${result.teamName}. It waits for a review.`,
            );
          } catch {
            setSaid("That could not be sent.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Share
      </Button>
      {said !== "" ? (
        <Text size="sm" color="secondary" role="status">
          {said}
        </Text>
      ) : null}
    </>
  );
}
