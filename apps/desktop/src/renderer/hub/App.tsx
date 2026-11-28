import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { FailureBanner } from "./FailureBanner";
import { Hub } from "./Hub";
import { ScratchpadApp } from "./ScratchpadApp";

/** The Scratchpad window loads this page at this hash (HB-26). */
export const SCRATCHPAD_WINDOW_HASH = "#/scratchpad-window";

/** Theme follows the system light/dark setting (Astryx `mode` defaults to "system"). */
export function App() {
  const scratchpad = window.location.hash.startsWith(SCRATCHPAD_WINDOW_HASH);
  return (
    <Theme theme={neutralTheme}>
      <FailureBanner />
      {scratchpad ? <ScratchpadApp /> : <Hub />}
    </Theme>
  );
}
