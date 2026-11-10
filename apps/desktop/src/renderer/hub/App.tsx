import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Hub } from "./Hub";

/** Theme follows the system light/dark setting (Astryx `mode` defaults to "system"). */
export function App() {
  return (
    <Theme theme={neutralTheme}>
      <Hub />
    </Theme>
  );
}
