import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { DEVELOPER_CLICKS, type AppInfo, type LoginItem } from "@murmur/shared";

/** Settings, General (HB-17): starting with the Mac, the Hub at start, and the version. */
export function GeneralSection({
  openHubOnLaunch,
  onOpenHubOnLaunch,
  profile,
  onProfile,
  theme,
  onTheme,
  developerMode,
  onDeveloperMode,
}: {
  openHubOnLaunch: boolean;
  onOpenHubOnLaunch: (on: boolean) => void;
  /** HB-51: the local display name. */
  profile: { displayName: string; showOnHome: boolean };
  onProfile: (profile: { displayName: string; showOnHome: boolean }) => void;
  /** HB-22. */
  theme: "system" | "light" | "dark";
  onTheme: (theme: "system" | "light" | "dark") => void;
  /** HB-20: clicking the version five times turns developer mode on. */
  developerMode: boolean;
  onDeveloperMode: () => void;
}) {
  const [clicks, setClicks] = useState(0);
  const [name, setName] = useState(profile.displayName);
  useEffect(() => setName(profile.displayName), [profile.displayName]);
  const [login, setLogin] = useState<LoginItem | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.murmur.loginItemGet().then(
      (value) => active && setLogin(value),
      () => active && setLogin({ available: false, enabled: false }),
    );
    window.murmur.getAppInfo().then(
      (value) => active && setInfo(value),
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  const setLaunch = (enabled: boolean) => {
    window.murmur.loginItemSet(enabled).then(
      (value) => {
        setLogin(value);
        setProblem(value.enabled === enabled ? null : "macOS did not change the login item.");
      },
      () => setProblem("Launch at login could not be changed."),
    );
  };

  return (
    <VStack gap={4}>
      <div data-setting="launch-at-login" className="hub-setting-row">
        <Switch
          label="Launch at login"
          description={
            login?.available === false
              ? "Only for the installed app; a development run cannot be added to login items."
              : "Start Murmur when you log in to this Mac."
          }
          value={login?.enabled ?? false}
          isDisabled={!login?.available}
          onChange={setLaunch}
        />
        {problem ? (
          <Text size="sm" color="secondary" role="alert">
            {problem}
          </Text>
        ) : null}
      </div>
      <div data-setting="open-hub" className="hub-setting-row">
        <Switch
          label="Show the Hub when Murmur starts"
          description="When off, Murmur starts in the menu bar; open the Hub from there. First-run setup always shows it."
          value={openHubOnLaunch}
          onChange={onOpenHubOnLaunch}
        />
      </div>
      <div data-setting="theme" className="hub-setting-row">
        <VStack gap={1}>
          <Text weight="semibold" id="theme-label">
            Appearance
          </Text>
          <HStack gap={1} role="radiogroup" aria-labelledby="theme-label">
            {(
              [
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ] as const
            ).map(([value, text]) => (
              <Button
                key={value}
                size="sm"
                variant={theme === value ? "secondary" : "ghost"}
                label={text}
                role="radio"
                aria-checked={theme === value}
                onClick={() => onTheme(value)}
              >
                {text}
              </Button>
            ))}
          </HStack>
          <Text size="sm" color="secondary">
            For the Hub, Scratchpad and the Rewrite and Instruct panels. System follows macOS. The
            Bar keeps its own dark look so it reads the same over any app.
          </Text>
        </VStack>
      </div>
      <div data-setting="display-name" className="hub-setting-row">
        <VStack gap={2}>
          <HStack gap={2} align="end" wrap="wrap">
            <TextInput
              label="Your name"
              description="Optional. Used only for the greeting on Home; never sent anywhere."
              value={name}
              onChange={(value) => setName(value.slice(0, 60))}
              onEnter={() => onProfile({ ...profile, displayName: name.trim() })}
            />
            <Button
              variant="secondary"
              label="Save your name"
              isDisabled={name.trim() === profile.displayName}
              onClick={() => onProfile({ ...profile, displayName: name.trim() })}
            >
              Save
            </Button>
          </HStack>
          <Switch
            label="Show my name on Home"
            value={profile.showOnHome}
            onChange={(showOnHome) => onProfile({ ...profile, showOnHome })}
          />
        </VStack>
      </div>
      {info ? (
        <VStack gap={1}>
          <button
            type="button"
            className="hub-version"
            data-testid="settings-version"
            onClick={() => {
              const next = clicks + 1;
              setClicks(next);
              if (next >= DEVELOPER_CLICKS && !developerMode) onDeveloperMode();
            }}
          >
            {info.name} {info.version}. Murmur never checks for updates by itself.
          </button>
          {developerMode ? (
            <Text size="sm" color="secondary" role="status">
              Developer mode is on: the Testing page is in the list.
            </Text>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  );
}
