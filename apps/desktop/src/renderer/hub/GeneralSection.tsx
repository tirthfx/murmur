import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { AppInfo, LoginItem } from "@murmur/shared";

/** Settings, General (HB-17): starting with the Mac, the Hub at start, and the version. */
export function GeneralSection({
  openHubOnLaunch,
  onOpenHubOnLaunch,
  profile,
  onProfile,
}: {
  openHubOnLaunch: boolean;
  onOpenHubOnLaunch: (on: boolean) => void;
  /** HB-51: the local display name. */
  profile: { displayName: string; showOnHome: boolean };
  onProfile: (profile: { displayName: string; showOnHome: boolean }) => void;
}) {
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
        <Text size="sm" color="secondary" data-testid="settings-version">
          {info.name} {info.version}. Murmur never checks for updates by itself.
        </Text>
      ) : null}
    </VStack>
  );
}
