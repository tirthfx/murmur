// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StyleInstructions } from "./StyleInstructions";
import { createMockApi, SAMPLE_STYLES } from "./test-api";

afterEach(cleanup);

describe("style instructions on My Voice (HB-09)", () => {
  it("saves a category's instructions with its own preset", async () => {
    const stylesUpdate = vi.fn().mockResolvedValue(SAMPLE_STYLES);
    window.murmur = createMockApi({ stylesUpdate });
    render(<StyleInstructions />);
    const first = SAMPLE_STYLES.styles[0]!;
    const box = await screen.findByLabelText(/Your own instructions for Personal/);
    fireEvent.change(box, { target: { value: "Use British spelling" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Personal instructions" }));
    await waitFor(() =>
      expect(stylesUpdate).toHaveBeenCalledWith({
        category: first.category,
        preset: first.preset,
        instructions: "Use British spelling",
      }),
    );
  });
});
