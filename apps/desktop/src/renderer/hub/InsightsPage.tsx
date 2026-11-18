import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  formatSpan,
  progressCardContent,
  type Milestone,
  INSIGHTS_RANGE_LABELS,
  INSIGHTS_RANGES,
  type InsightsRange,
  type InsightsView,
  type SettingsView,
  type VoiceProfileView,
} from "@murmur/shared";

import { renderProgressCard } from "./progress-card";

type Tab = "usage" | "voice" | "leaderboard";

const TABS: { id: Tab; title: string }[] = [
  { id: "usage", title: "Your usage" },
  { id: "voice", title: "Your voice" },
  { id: "leaderboard", title: "Leaderboard" },
];

/** Typing speeds to measure time saved against (HB-36: 10 to 150). */
const TYPING_SPEEDS = [10, 20, 30, 40, 50, 60, 70, 80, 100, 120, 150];

const number = (value: number) => value.toLocaleString();

function plural(count: number, one: string, many: string): string {
  return `${number(count)} ${count === 1 ? one : many}`;
}

function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function Card({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <div className="hub-insights-card" role="group" aria-label={title}>
      <Text size="sm" color="secondary">
        {title}
      </Text>
      <Text size="lg" weight="semibold">
        {value}
      </Text>
      {note ? (
        <Text size="xsm" color="secondary">
          {note}
        </Text>
      ) : null}
    </div>
  );
}

function Usage({
  view,
  typingWpm,
  onTypingWpm,
}: {
  view: InsightsView;
  typingWpm: number;
  onTypingWpm: (wpm: number) => void;
}) {
  const [exported, setExported] = useState<string | null>(null);

  async function exportCsv() {
    try {
      const result = await window.murmur.insightsExport(view.range);
      setExported(result.saved ? `Saved ${plural(result.rows, "day", "days")} as CSV.` : null);
    } catch {
      setExported("The file could not be saved.");
    }
  }

  const streak = (
    title: string,
    value: { current: number; longest: number; counted: boolean },
    unit: [string, string],
    waiting: string,
  ) => (
    <Card
      title={title}
      value={plural(value.current, unit[0], unit[1])}
      note={`Longest ${plural(value.longest, unit[0], unit[1])}. ${value.counted ? "" : waiting}`.trim()}
    />
  );

  return (
    <VStack gap={4}>
      {view.empty ? (
        <Text color="secondary">
          Nothing dictated in this range yet. Words, speed, apps and streaks show here after your
          first dictation.
        </Text>
      ) : null}
      <div className="hub-insights-grid">
        <Card title="Words dictated" value={number(view.words)} />
        <Card title="Dictations" value={number(view.dictations)} />
        <Card title="Average words per dictation" value={number(view.averageWords)} />
        <Card title="Speaking time" value={formatSpan(view.speakingMs)} />
        <Card
          title="Time saved (estimate)"
          value={formatSpan(view.timeSavedMs)}
          note={`Against typing at ${view.typingWpm} words a minute.`}
        />
        <Card
          title="Words per minute"
          value={view.wpm === null ? "Not yet" : String(view.wpm)}
          note={
            view.bestDay
              ? `Best day ${formatDay(view.bestDay.date)}: ${view.bestDay.wpm}.`
              : "From dictations of 20 seconds or more."
          }
        />
        {streak("Daily streak", view.daily, ["day", "days"], "Dictate today to keep it going.")}
        {streak("Weekly streak", view.weekly, ["week", "weeks"], "This week counts after 3 days.")}
      </div>

      <VStack gap={2}>
        <Heading level={3}>Top apps</Heading>
        {view.topApps.length === 0 && !view.other ? (
          <Text color="secondary">No apps yet.</Text>
        ) : (
          <ol className="hub-insights-apps" aria-label="Top apps">
            {view.topApps.map((app) => (
              <li key={app.bundleId}>
                <HStack gap={2} align="center" justify="between">
                  <Text weight="semibold">{app.name}</Text>
                  <Text size="sm" color="secondary">
                    {plural(app.words, "word", "words")} ·{" "}
                    {plural(app.dictations, "dictation", "dictations")} · {app.share}%
                  </Text>
                </HStack>
                <div className="hub-insights-bar" aria-hidden="true">
                  <span style={{ width: `${app.share}%` }} />
                </div>
              </li>
            ))}
            {view.other ? (
              <li>
                <HStack gap={2} align="center" justify="between">
                  <Text weight="semibold">Other</Text>
                  <Text size="sm" color="secondary">
                    {plural(view.other.words, "word", "words")} · {view.other.share}%
                  </Text>
                </HStack>
                <div className="hub-insights-bar" aria-hidden="true">
                  <span style={{ width: `${view.other.share}%` }} />
                </div>
              </li>
            ) : null}
          </ol>
        )}
      </VStack>

      <Milestones view={view} />

      <HStack gap={3} align="end" wrap="wrap">
        <Selector
          label="Typing speed for time saved"
          description="Words a minute you type; time saved counts against it."
          options={TYPING_SPEEDS.map((wpm) => ({ value: String(wpm), label: `${wpm} wpm` }))}
          value={String(typingWpm)}
          onChange={(value) => onTypingWpm(Number(value))}
        />
        <Button
          variant="secondary"
          label="Export this range as CSV"
          onClick={() => void exportCsv()}
        >
          Export CSV
        </Button>
      </HStack>
      {exported ? (
        <Text size="sm" color="secondary" role="status">
          {exported}
        </Text>
      ) : null}
      <Text size="xsm" color="secondary">
        Worked out on this Mac from daily counts. No dictated text is read for Insights.
      </Text>
    </VStack>
  );
}

function formatAchieved(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Milestones (HB-41) and the progress card (HB-44). */
function Milestones({ view }: { view: InsightsView }) {
  const [items, setItems] = useState<Milestone[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.murmur.milestonesList().then(
      (list) => {
        if (!active) return;
        setItems(list);
        if (list.some((item) => item.isNew)) void window.murmur.milestonesSeen();
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  const reached = items.filter((item) => item.achievedAt !== null);
  const ahead = items.filter((item) => item.achievedAt === null);

  async function card(item: Milestone, action: "save" | "copy") {
    try {
      const png = await renderProgressCard(
        progressCardContent(item, { words: view.words, streak: view.daily.current }),
      );
      if (action === "copy") {
        await window.murmur.progressCardCopy(png);
        setMessage("Progress card copied.");
      } else {
        const result = await window.murmur.progressCardSave(png);
        setMessage(result.saved ? "Progress card saved." : null);
      }
    } catch {
      setMessage("The progress card could not be made.");
    }
  }

  return (
    <VStack gap={2}>
      <Heading level={3}>Milestones</Heading>
      {reached.length === 0 ? (
        <Text color="secondary">No milestones yet. Your first dictation is the first one.</Text>
      ) : (
        <ul className="hub-insights-milestones" aria-label="Milestones reached">
          {reached.map((item) => (
            <li key={item.key} className="hub-insights-card">
              <HStack gap={2} align="center" justify="between" wrap="wrap">
                <VStack gap={0}>
                  <Text weight="semibold">
                    {item.title}
                    {item.isNew ? " · New" : ""}
                  </Text>
                  <Text size="sm" color="secondary">
                    {item.detail} {formatAchieved(item.achievedAt!)}.
                  </Text>
                </VStack>
                <HStack gap={1}>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={`Save a progress card for ${item.title}`}
                    onClick={() => void card(item, "save")}
                  >
                    Save card
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={`Copy a progress card for ${item.title}`}
                    onClick={() => void card(item, "copy")}
                  >
                    Copy card
                  </Button>
                </HStack>
              </HStack>
            </li>
          ))}
        </ul>
      )}
      {ahead.length > 0 ? (
        <Text size="sm" color="secondary">
          Still ahead: {ahead.map((item) => item.title).join(", ")}.
        </Text>
      ) : null}
      {message ? (
        <Text size="sm" color="secondary" role="status">
          {message}
        </Text>
      ) : null}
      <Text size="xsm" color="secondary">
        Cards show the milestone, a count and the date. They are made on this Mac and never posted.
      </Text>
    </VStack>
  );
}

function Voice() {
  const [profile, setProfile] = useState<VoiceProfileView | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void window.murmur.voiceProfileView().then(
      (value) => active && setProfile(value),
      () => {},
    );
    void window.murmur.getSettings().then(
      (view: SettingsView) => active && setEnabled(view.settings.voiceProfile.enabled),
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  const openMyVoice = (
    <div>
      <Button
        variant="secondary"
        label="Open My Voice"
        onClick={() => {
          window.location.hash = "#/my-voice";
        }}
      >
        Open My Voice
      </Button>
    </div>
  );

  if (enabled === false) {
    return (
      <VStack gap={2}>
        <Text color="secondary">Voice Profile is off. Turn it on from the My Voice page.</Text>
        {openMyVoice}
      </VStack>
    );
  }
  if (!profile) return null;
  return (
    <VStack gap={3}>
      {profile.summary ? (
        <Text>{profile.summary}</Text>
      ) : (
        <Text color="secondary">
          Not enough data yet. Your summary appears after more dictations ({profile.sessions} so
          far).
        </Text>
      )}
      {profile.topPhrases.length > 0 ? (
        <VStack gap={1}>
          <Heading level={3}>Phrases you use most</Heading>
          <ol aria-label="Top phrases">
            {profile.topPhrases.slice(0, 10).map((phrase) => (
              <li key={phrase}>{phrase}</li>
            ))}
          </ol>
        </VStack>
      ) : null}
      {openMyVoice}
    </VStack>
  );
}

/** Insights (HB-11): usage, your voice, and a note that there is no leaderboard. */
export function InsightsPage() {
  const [tab, setTab] = useState<Tab>("usage");
  const [range, setRange] = useState<InsightsRange>("30");
  const [view, setView] = useState<InsightsView | null>(null);
  const [typingWpm, setTypingWpm] = useState(40);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async (next: InsightsRange) => {
    try {
      setView(await window.murmur.insightsView(next));
      setProblem(null);
    } catch {
      setProblem("Insights could not be read.");
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  useEffect(() => {
    void window.murmur.getSettings().then(
      (settings) => setTypingWpm(settings.settings.insights.typingWpm),
      () => {},
    );
  }, []);

  async function changeTyping(wpm: number) {
    setTypingWpm(wpm);
    await window.murmur.updateSettings({ insights: { typingWpm: wpm } });
    await load(range);
  }

  return (
    <VStack gap={4}>
      <HStack gap={1} role="group" aria-label="Insights">
        {TABS.map((item) => (
          <Button
            key={item.id}
            variant={tab === item.id ? "secondary" : "ghost"}
            label={item.title}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.title}
          </Button>
        ))}
      </HStack>

      {tab === "usage" ? (
        <VStack gap={3}>
          <HStack gap={1} role="group" aria-label="Range" wrap="wrap">
            {INSIGHTS_RANGES.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={range === item ? "secondary" : "ghost"}
                label={INSIGHTS_RANGE_LABELS[item]}
                aria-pressed={range === item}
                onClick={() => setRange(item)}
              >
                {INSIGHTS_RANGE_LABELS[item]}
              </Button>
            ))}
          </HStack>
          {problem ? <Banner status="error" title={problem} /> : null}
          {view ? (
            <Usage
              view={view}
              typingWpm={typingWpm}
              onTypingWpm={(wpm) => void changeTyping(wpm)}
            />
          ) : null}
        </VStack>
      ) : tab === "voice" ? (
        <Voice />
      ) : (
        <VStack gap={2}>
          <Text>Leaderboards need a team, which Murmur does not have.</Text>
          <Text color="secondary">
            Your own numbers and streaks are on the Your usage tab. Nothing is compared with anyone
            else.
          </Text>
        </VStack>
      )}
    </VStack>
  );
}
