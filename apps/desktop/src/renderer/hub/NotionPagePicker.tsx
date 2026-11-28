import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Selector } from "@astryxdesign/core/Selector";
import { VStack } from "@astryxdesign/core/VStack";
import type { LinkablePage } from "@murmur/shared";

const NONE = "";

/** CN-06: attaches one of the person's Notion pages to a meeting as a link. */
export function NotionPagePicker({
  meetingId,
  onAdded,
}: {
  meetingId: string;
  onAdded: () => void;
}) {
  const [pages, setPages] = useState<LinkablePage[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.murmur.notionPages().then((list) => alive && setPages(list));
    return () => {
      alive = false;
    };
  }, []);

  if (pages.length === 0) return null;

  async function add(url: string) {
    const page = pages.find((candidate) => candidate.url === url);
    if (!page) return;
    setMessage(null);
    const result = await window.murmur.meetingDocAddLink(meetingId, page.url, page.title);
    if (result.ok) onAdded();
    else setMessage(result.message);
  }

  return (
    <VStack gap={1}>
      <Selector
        label="Add a Notion page"
        value={NONE}
        options={[
          { value: NONE, label: "Choose a page…" },
          ...pages.map((page) => ({ value: page.url, label: page.title })),
        ]}
        onChange={(url) => void add(url)}
      />
      {message ? <Banner status="warning" title={message} /> : null}
    </VStack>
  );
}
