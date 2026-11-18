import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import type { AppInfo } from "@murmur/shared";
import { Button } from "@astryxdesign/core/Button";
import { DictionaryPage } from "./DictionaryPage";
import { SnippetsPage } from "./SnippetsPage";
import { StylesPage } from "./StylesPage";
import { InstructPage } from "./InstructPage";
import { MemoryPage } from "./MemoryPage";
import { RewritesPage } from "./RewritesPage";
import { MyVoicePage } from "./MyVoicePage";
import { HelperStatusLine } from "./HelperStatusLine";
import { Onboarding } from "./Onboarding";
import { MicCheckSection } from "./MicCheckSection";
import { PermissionsSection } from "./PermissionsSection";
import { SettingsSection } from "./SettingsSection";
import { pageFromHash, resolvePage, visiblePages, type PageFeatures, type PageId } from "./pages";

function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let active = true;
    window.murmur
      .getAppInfo()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch(() => {
        // The version label is informational; the Hub works without it.
      });
    return () => {
      active = false;
    };
  }, []);

  return info;
}

/**
 * Whether first-run setup still has to run. "loading" until the settings arrive, so a new
 * profile never shows the Hub first. If the settings cannot be read the Hub opens anyway.
 */
function useSetupState() {
  const [state, setState] = useState<"loading" | "needed" | "done">("loading");
  useEffect(() => {
    let active = true;
    window.murmur.getSettings().then(
      (view) => active && setState(view.settings.setupComplete ? "done" : "needed"),
      () => active && setState("done"),
    );
    return () => {
      active = false;
    };
  }, []);
  return [state, () => setState("done")] as const;
}

export function Hub() {
  const [setup, finishSetup] = useSetupState();
  const [revisit, setRevisit] = useState(false);
  if (setup === "loading") return null;
  if (setup === "needed") return <Onboarding isRevisit={false} onFinished={finishSetup} />;
  if (revisit) return <Onboarding isRevisit onFinished={() => setRevisit(false)} />;
  return <HubPages onRunSetup={() => setRevisit(true)} />;
}

/** Feature switches that hide pages; none yet have a setting (Scratchpad's comes with #152). */
const FEATURES: PageFeatures = {};

function HubPages({ onRunSetup }: { onRunSetup: () => void }) {
  const [pageId, setPageIdState] = useState<PageId>(
    () => resolvePage(pageFromHash(window.location.hash) ?? "home", FEATURES).id,
  );
  const info = useAppInfo();
  const pages = visiblePages(FEATURES);

  // HB-01: the hash names the page; main remembers it for the next start.
  const setPageId = useCallback((id: string) => {
    const next = resolvePage(id, FEATURES).id;
    setPageIdState(next);
    if (window.location.hash !== `#/${next}`) window.history.replaceState(null, "", `#/${next}`);
    void window.murmur.hubSetPage(next).catch(() => {});
  }, []);

  useEffect(() => {
    const onHash = () => {
      const id = pageFromHash(window.location.hash);
      if (id) setPageIdState(resolvePage(id, FEATURES).id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Main can ask for a page: the last one at start, or one after a Bar prompt.
  useEffect(() => window.murmur.onOpenPage(setPageId), [setPageId]);
  const page = resolvePage(pageId, FEATURES);

  const sideNav = (
    <SideNav
      aria-label="Hub pages"
      header={
        <>
          <div className="hub-nav-top-spacer" />
          <SideNavHeading heading="Murmur" />
        </>
      }
      footer={
        info ? (
          <Text size="xsm" color="secondary" data-testid="app-version">
            Version {info.version}
          </Text>
        ) : undefined
      }
    >
      <SideNavSection title="Pages" isHeaderHidden>
        {pages.map((item) => (
          <SideNavItem
            key={item.id}
            label={item.title}
            isSelected={item.id === pageId}
            onClick={() => setPageId(item.id)}
          />
        ))}
      </SideNavSection>
    </SideNav>
  );

  return (
    <>
      <div className="hub-drag-region" aria-hidden="true" />
      <AppShell sideNav={sideNav} contentPadding={0}>
        <div className="hub-page">
          <Heading level={1}>{page.title}</Heading>
          {page.id === "settings" ? (
            <>
              <SettingsSection />
              <MicCheckSection />
              <PermissionsSection />
              <section className="hub-permissions" aria-labelledby="setup-heading">
                <Heading level={2} id="setup-heading">
                  Setup
                </Heading>
                <Text size="sm" color="secondary">
                  Go through the first-run steps again: permissions, the speech model, the shortcut
                  and a test dictation.
                </Text>
                <div>
                  <Button variant="secondary" label="Run setup again" onClick={onRunSetup}>
                    Run setup again
                  </Button>
                </div>
              </section>
            </>
          ) : page.id === "dictionary" ? (
            <DictionaryPage />
          ) : page.id === "snippets" ? (
            <SnippetsPage />
          ) : page.id === "styles" ? (
            <StylesPage />
          ) : page.id === "rewrites" ? (
            <RewritesPage />
          ) : page.id === "instruct" ? (
            <InstructPage />
          ) : page.id === "memory" ? (
            <MemoryPage />
          ) : page.id === "my-voice" ? (
            <MyVoicePage />
          ) : (
            <div className="hub-empty">
              <EmptyState
                title={page.emptyTitle}
                description={page.emptyDescription}
                headingLevel={2}
              />
            </div>
          )}
          {page.id === "settings" ? <HelperStatusLine /> : null}
        </div>
      </AppShell>
    </>
  );
}
