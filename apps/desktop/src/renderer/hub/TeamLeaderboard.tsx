import { useCallback, useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { LeaderboardPeriod, TeamLeaderboardAnswer } from "@murmur/shared";

const METRICS = { words: "words dictated", meetings: "meetings recorded", streak: "active days" };

/** TM-26: the team's leaderboard on Insights, and whether this person is listed. */
export function TeamLeaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [answer, setAnswer] = useState<TeamLeaderboardAnswer | null>(null);

  const load = useCallback(() => window.murmur.teamLeaderboard(period).then(setAnswer), [period]);
  useEffect(() => void load(), [load]);

  if (!answer) return <Text color="secondary">Reading the leaderboard…</Text>;
  if (!answer.ok) {
    return (
      <VStack gap={2}>
        <Text>{answer.message}</Text>
        <Text color="secondary">
          Your own numbers and streaks are on the Your usage tab. Team mode is set up in Settings.
        </Text>
      </VStack>
    );
  }
  const { board, teamName } = answer;
  if (!board.enabled) return <Text>{teamName} has the leaderboard turned off.</Text>;

  return (
    <VStack gap={3}>
      <HStack gap={1}>
        {(["week", "all"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={period === value ? "primary" : "secondary"}
            label={value === "week" ? "Last seven days" : "All time"}
            onClick={() => setPeriod(value)}
          >
            {value === "week" ? "Last seven days" : "All time"}
          </Button>
        ))}
      </HStack>
      <Text color="secondary">
        {teamName}: {METRICS[board.metric]}. Total {board.total.toLocaleString("en")}.
        {board.hiddenCount > 0 ? ` ${board.hiddenCount} not listed.` : ""}
      </Text>
      <ol className="hub-dictionary-list" aria-label="Leaderboard">
        {board.ranks.map((row) => (
          <li key={`${row.rank}-${row.name}`}>
            <Text weight={row.isMe ? "semibold" : "normal"}>
              {row.rank}. {row.name}
              {row.isMe ? " (you)" : ""}
              {row.value === null ? "" : ` · ${row.value.toLocaleString("en")}`}
            </Text>
          </li>
        ))}
      </ol>
      <Switch
        label="List me on the leaderboard"
        value={board.me.visible}
        onChange={(visible) => void window.murmur.teamLeaderboardShow(visible).then(load)}
      />
    </VStack>
  );
}
