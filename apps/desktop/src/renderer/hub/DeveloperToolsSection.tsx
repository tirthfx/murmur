import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { CODING_CLI_NAME, type DeveloperTools } from "@murmur/shared";

/** One folder per line, at most ten. */
export function parseFolders(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/** Comma or space separated, lower case, valid names only, each once. */
export function parseCliNames(text: string): string[] {
  const names = text
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((name) => CODING_CLI_NAME.test(name));
  return [...new Set(names)].slice(0, 50);
}

/** File tags, names on screen and coding CLI detection (PZ-24, PZ-25, PZ-28). All off by default. */
export function DeveloperToolsSection() {
  const [tools, setTools] = useState<DeveloperTools | null>(null);
  const [folders, setFolders] = useState("");
  const [names, setNames] = useState("");

  useEffect(() => {
    window.murmur.getSettings().then(
      (view) => {
        setTools(view.settings.developerTools);
        setFolders(view.settings.developerTools.codeFolders.join("\n"));
        setNames(view.settings.developerTools.cliNames.join(", "));
      },
      () => setTools(null),
    );
  }, []);

  async function update(patch: Partial<DeveloperTools>) {
    if (!tools) return;
    const next = await window.murmur.updateSettings({ developerTools: { ...tools, ...patch } });
    setTools(next.settings.developerTools);
    setFolders(next.settings.developerTools.codeFolders.join("\n"));
    setNames(next.settings.developerTools.cliNames.join(", "));
  }

  if (!tools) return null;
  return (
    <section aria-labelledby="developer-tools-heading">
      <VStack gap={2}>
        <Heading level={3} id="developer-tools-heading">
          More for developers
        </Heading>
        <Switch
          label="File tags in AI editors"
          description="In Cursor, VS Code, Windsurf and Zed, “at session dot ts” inserts @src/auth/session.ts when that file is in the open project. Files listed in .gitignore are skipped."
          value={tools.fileTags}
          onChange={(fileTags) => void update({ fileTags })}
        />
        {tools.fileTags ? (
          <VStack gap={1}>
            <TextArea
              label="Code folders"
              description="Folders that hold your projects, one per line, for example ~/Developer. An editor's title names the project folder; Murmur looks for it here."
              rows={3}
              value={folders}
              onChange={setFolders}
            />
            <div>
              <Button
                size="sm"
                variant="secondary"
                label="Save code folders"
                isDisabled={folders === tools.codeFolders.join("\n")}
                onClick={() => void update({ codeFolders: parseFolders(folders) })}
              >
                Save folders
              </Button>
            </div>
          </VStack>
        ) : null}
        <Switch
          label="Match names on screen"
          description="A name you say, such as “fetch user profile”, is written as the one on screen (fetchUserProfile). VS Code and Cursor show their text only with screen reader mode on."
          value={tools.variables}
          onChange={(variables) => void update({ variables })}
        />
        <Switch
          label="Detect coding tools in the terminal"
          description="When a listed coding tool runs in the terminal in front, dictation there is treated as code. Only process names are checked, when a dictation starts; nothing is saved."
          value={tools.cliDetection}
          onChange={(cliDetection) => void update({ cliDetection })}
        />
        {tools.cliDetection ? (
          <VStack gap={1}>
            <TextInput
              label="Coding tools"
              description="Command names, separated by commas."
              value={names}
              onChange={setNames}
            />
            <div>
              <Button
                size="sm"
                variant="secondary"
                label="Save coding tools"
                isDisabled={names === tools.cliNames.join(", ")}
                onClick={() => void update({ cliNames: parseCliNames(names) })}
              >
                Save tools
              </Button>
            </div>
          </VStack>
        ) : null}
        <Text size="sm" color="secondary">
          All three are off until you turn them on.
        </Text>
      </VStack>
    </section>
  );
}
