// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOURS, tourToOffer } from "@murmur/shared";
import { TourOffer } from "./TourOffer";

afterEach(cleanup);

describe("a tour on first use (HB-08)", () => {
  const help = { tours: {}, offerTours: true };

  it("is offered once, on its own page, while offers are on", () => {
    expect(tourToOffer("dictionary", help, false)?.id).toBe("dictionary-snippets");
    expect(tourToOffer("history", help, false)).toBeNull();
    expect(tourToOffer("dictionary", { ...help, offerTours: false }, false)).toBeNull();
    const seen = { "dictionary-snippets": { step: 0, done: true } };
    expect(tourToOffer("snippets", { ...help, tours: seen }, false)).toBeNull();
  });

  it("starts or is dismissed", () => {
    const onStart = vi.fn();
    const onDismiss = vi.fn();
    render(<TourOffer tour={TOURS[0]!} onStart={onStart} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: `Take the tour: ${TOURS[0]!.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
