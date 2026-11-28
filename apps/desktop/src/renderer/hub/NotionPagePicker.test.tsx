// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotionPagePicker } from "./NotionPagePicker";
import { createMockApi } from "./test-api";

afterEach(cleanup);

describe("attaching a Notion page (CN-06)", () => {
  it("adds the chosen page as a link", async () => {
    const meetingDocAddLink = vi.fn().mockResolvedValue({ ok: true });
    window.murmur = createMockApi({
      notionPages: vi
        .fn()
        .mockResolvedValue([{ title: "Roadmap", url: "https://notion.so/roadmap" }]),
      meetingDocAddLink,
    });
    const onAdded = vi.fn();
    render(<NotionPagePicker meetingId="m1" onAdded={onAdded} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Add a Notion page" }));
    fireEvent.click(await screen.findByRole("option", { name: "Roadmap" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(meetingDocAddLink).toHaveBeenCalledWith("m1", "https://notion.so/roadmap", "Roadmap");
  });

  it("shows nothing when no page was read", () => {
    window.murmur = createMockApi();
    const { container } = render(<NotionPagePicker meetingId="m1" onAdded={() => undefined} />);
    expect(container.textContent).toBe("");
  });
});
