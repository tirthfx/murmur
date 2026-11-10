import { useEffect, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import type { AppInfo } from "@murmur/shared";
import { HelperStatusLine } from "./HelperStatusLine";
import { PAGES, type PageId } from "./pages";

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

export function Hub() {
  const [pageId, setPageId] = useState<PageId>("home");
  const info = useAppInfo();
  const page = PAGES.find((candidate) => candidate.id === pageId) ?? PAGES[0];

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
        {PAGES.map((item) => (
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
          <div className="hub-empty">
            <EmptyState
              title={page.emptyTitle}
              description={page.emptyDescription}
              headingLevel={2}
            />
          </div>
          {page.id === "settings" ? <HelperStatusLine /> : null}
        </div>
      </AppShell>
    </>
  );
}
