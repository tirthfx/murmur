import { Banner } from "@astryxdesign/core/Banner";
import { HelperBanner } from "./HelperBanner";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import type { AppInfo } from "@murmur/shared";
import { DictionaryPage } from "./DictionaryPage";
import { SnippetsPage } from "./SnippetsPage";
import { StylesPage } from "./StylesPage";
import { InstructPage } from "./InstructPage";
import { ExtensionsPage } from "./ExtensionsPage";
import { ConnectorsPage } from "./ConnectorsPage";
import { NotetakerPage } from "./NotetakerPage";
import { MemoryPage } from "./MemoryPage";
import { RewritesPage } from "./RewritesPage";
import { MyVoicePage } from "./MyVoicePage";
import { HistoryPage } from "./HistoryPage";
import { HomePage } from "./HomePage";
import { ScratchpadPage } from "./ScratchpadPage";
import { HelpPage } from "./HelpPage";
import { TourCard } from "./TourCard";
import { DictationPage } from "./DictationPage";
import { InsightsPage } from "./InsightsPage";
import { Onboarding } from "./Onboarding";
import { SettingsPage } from "./SettingsPage";
import { TourOffer } from "./TourOffer";
import { tourToOffer, type Tour } from "@murmur/shared";
import {
  pageFromHash,
  resolvePage,
  visiblePages,
  type Page,
  type PageFeatures,
  type PageId,
} from "./pages";

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

function HubPages({ onRunSetup }: { onRunSetup: () => void }) {
  // Switches that hide pages (HB-34); read again on every page change, so a switch turned off
  // in Settings hides its page as soon as another page is chosen.
  const [features, setFeatures] = useState<PageFeatures>({});
  const [pageId, setPageIdState] = useState<PageId>(
    () => resolvePage(pageFromHash(window.location.hash) ?? "home", {}).id,
  );
  const info = useAppInfo();
  const [creatorMode, setCreatorMode] = useState(false);
  // HB-08: a tour offered the first time its page is opened.
  const [offer, setOffer] = useState<Tour | null>(null);
  const pages = visiblePages(features, creatorMode);
  useEffect(() => {
    let active = true;
    window.murmur.getSettings().then(
      (view) => {
        if (!active) return;
        setFeatures({ scratchpad: view.settings.scratchpad.enabled });
        setCreatorMode(view.settings.creatorMode);
        setOffer(tourToOffer(pageId, view.settings.help, view.settings.experimental.commandMode));
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [pageId]);
  const featuresRef = useRef(features);
  featuresRef.current = features;

  // HB-01: the hash names the page; main remembers it for the next start.
  const setPageId = useCallback((id: string) => {
    const next = resolvePage(id, featuresRef.current).id;
    setPageIdState(next);
    if (pageFromHash(window.location.hash) !== next) {
      window.history.replaceState(null, "", `#/${next}`);
    }
    void window.murmur.hubSetPage(next).catch(() => {});
  }, []);

  useEffect(() => {
    const onHash = () => {
      const id = pageFromHash(window.location.hash);
      if (id) setPageIdState(resolvePage(id, featuresRef.current).id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // HB-08: the tour in progress, if any; its step is saved so it can be resumed.
  const [tour, setTour] = useState<{ tour: Tour; step: number } | null>(null);
  const saveTour = useCallback(async (id: string, step: number, done: boolean) => {
    try {
      const view = await window.murmur.getSettings();
      const { help } = view.settings;
      await window.murmur.updateSettings({
        help: { ...help, tours: { ...help.tours, [id]: { step, done } } },
      });
    } catch {
      // Progress is a help; the tour works without it.
    }
  }, []);
  const startTour = useCallback(
    (next: Tour, step: number) => {
      setTour({ tour: next, step });
      void saveTour(next.id, step, false);
    },
    [saveTour],
  );

  // Main can ask for a page: the last one at start, or one after a Bar prompt.
  useEffect(() => window.murmur.onOpenPage(setPageId), [setPageId]);
  const page = resolvePage(pageId, features);

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
          {info?.sandbox ? (
            <Banner
              status="info"
              title="Sandbox: demo data"
              description="Your own data is not open. Leave from Settings, Testing, or quit Murmur."
            />
          ) : null}
          <HelperBanner />
          <Heading level={1}>{page.title}</Heading>
          {page.id === "settings" ? (
            <SettingsPage onRunSetup={onRunSetup} />
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
          ) : page.id === "help" ? (
            <HelpPage onStartTour={startTour} onRunSetup={onRunSetup} />
          ) : page.id === "scratchpad" ? (
            <ScratchpadPage />
          ) : page.id === "home" ? (
            <HomePage />
          ) : page.id === "dictation" ? (
            <DictationPage />
          ) : page.id === "notetaker" ? (
            <NotetakerPage />
          ) : page.id === "connectors" ? (
            <ConnectorsPage />
          ) : page.id === "extensions" ? (
            <ExtensionsPage />
          ) : page.id === "history" ? (
            <HistoryPage />
          ) : page.id === "insights" ? (
            <InsightsPage />
          ) : (
            <div className="hub-empty">
              {/* A page added later shows its empty state until it is built. */}
              <EmptyState
                title={(page as Page).emptyTitle}
                description={(page as Page).emptyDescription}
                headingLevel={2}
              />
            </div>
          )}
        </div>
      </AppShell>
      {offer && !tour ? (
        <TourOffer
          tour={offer}
          onStart={() => {
            setOffer(null);
            startTour(offer, 0);
          }}
          onDismiss={() => {
            setOffer(null);
            void saveTour(offer.id, 0, true);
          }}
        />
      ) : null}
      {tour ? (
        <TourCard
          tour={tour.tour}
          step={tour.step}
          onStep={(step) => {
            setTour({ tour: tour.tour, step });
            void saveTour(tour.tour.id, step, false);
          }}
          onStop={(finished) => {
            if (finished) void saveTour(tour.tour.id, 0, true);
            setTour(null);
          }}
        />
      ) : null}
    </>
  );
}
