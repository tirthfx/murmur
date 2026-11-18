import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { HelperStatusLine } from "./HelperStatusLine";
import { SettingsSection } from "./SettingsSection";
import {
  SETTINGS_PAGES,
  searchSettings,
  settingsPageFromHash,
  type SettingEntry,
  type SettingsPageId,
} from "./settings-pages";

/** How long a setting found by search stays highlighted. */
const HIGHLIGHT_MS = 2000;

/** Settings (HB-12): a list of pages, one page at a time, and a search over every setting. */
export function SettingsPage({ onRunSetup }: { onRunSetup: () => void }) {
  const [pageId, setPageIdState] = useState<SettingsPageId>(
    () => settingsPageFromHash(window.location.hash) ?? "general",
  );
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);

  const setPageId = useCallback((id: SettingsPageId) => {
    setPageIdState(id);
    window.history.replaceState(null, "", `#/settings/${id}`);
  }, []);

  useEffect(() => {
    const onHash = () => {
      const id = settingsPageFromHash(window.location.hash);
      if (id) setPageIdState(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // A setting found by search: wait for its row to render, then scroll to it and highlight it.
  useEffect(() => {
    if (target === null) return;
    let tries = 0;
    let timer = 0;
    const find = () => {
      const row = content.current?.querySelector<HTMLElement>(`[data-setting="${target}"]`);
      if (row) {
        row.scrollIntoView?.({ block: "center" });
        row.classList.add("hub-setting-found");
        timer = window.setTimeout(() => {
          row.classList.remove("hub-setting-found");
          setTarget(null);
        }, HIGHLIGHT_MS);
        return;
      }
      if (++tries < 20) timer = window.setTimeout(find, 50);
      else setTarget(null);
    };
    find();
    return () => window.clearTimeout(timer);
  }, [target, pageId]);

  const results = searchSettings(query);
  const open = (entry: SettingEntry) => {
    setQuery("");
    setPageId(entry.page);
    setTarget(entry.id);
  };

  return (
    <div className="hub-settings-layout">
      <nav aria-label="Settings pages" className="hub-settings-nav">
        <VStack gap={1}>
          {SETTINGS_PAGES.map((page) => (
            <Button
              key={page.id}
              variant={page.id === pageId ? "secondary" : "ghost"}
              label={page.title}
              aria-current={page.id === pageId ? "page" : undefined}
              onClick={() => setPageId(page.id)}
            >
              {page.title}
            </Button>
          ))}
        </VStack>
      </nav>
      <div className="hub-settings-content" ref={content}>
        <VStack gap={4}>
          <div className="hub-settings-search">
            <TextInput
              label="Search settings"
              placeholder="Find a setting"
              value={query}
              onChange={setQuery}
              hasClear
              onEnter={() => {
                if (results[0]) open(results[0]);
              }}
            />
            {query.trim() !== "" ? (
              results.length === 0 ? (
                <Text size="sm" color="secondary" role="status">
                  No setting matches.
                </Text>
              ) : (
                <ul className="hub-settings-results" aria-label="Matching settings">
                  {results.map((entry) => (
                    <li key={entry.id}>
                      <HStack gap={2} align="center">
                        <Button variant="ghost" label={entry.label} onClick={() => open(entry)}>
                          {entry.label}
                        </Button>
                        <Text size="sm" color="secondary">
                          {SETTINGS_PAGES.find((page) => page.id === entry.page)?.title}
                        </Text>
                      </HStack>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
          <Heading level={2}>{SETTINGS_PAGES.find((page) => page.id === pageId)?.title}</Heading>
          <SettingsSection page={pageId} onRunSetup={onRunSetup} />
          {pageId === "general" ? <HelperStatusLine /> : null}
        </VStack>
      </div>
    </div>
  );
}
