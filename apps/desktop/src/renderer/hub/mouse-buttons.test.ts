import { describe, expect, it } from "vitest";
import { buttonFromBrowser, mouseButtonLabel } from "./mouse-buttons";

describe("mouse buttons", () => {
  it("maps browser buttons to bindable ones and refuses left and right", () => {
    expect(buttonFromBrowser(0)).toBeNull();
    expect(buttonFromBrowser(2)).toBeNull();
    expect(buttonFromBrowser(1)).toBe(2);
    expect(buttonFromBrowser(3)).toBe(3);
    expect(buttonFromBrowser(4)).toBe(4);
  });

  it("names the buttons", () => {
    expect(mouseButtonLabel(null)).toBe("Not set");
    expect(mouseButtonLabel(2)).toBe("Middle button");
    expect(mouseButtonLabel(3)).toBe("Back button");
    expect(mouseButtonLabel(7)).toBe("Mouse button 8");
  });
});
