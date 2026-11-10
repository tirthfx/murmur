import type { BrowserWindowConstructorOptions } from "electron";

export interface HubWindowOptionsInput {
  /** Absolute path to the built preload script. */
  preloadPath: string;
  /** Value of `process.platform`. */
  platform: string;
  /** Development builds only: allows the developer tools. */
  isDevelopment: boolean;
}

export const HUB_MIN_WIDTH = 960;
export const HUB_MIN_HEIGHT = 640;

/**
 * Options for the Hub window. The security-relevant web preferences are fixed
 * here and covered by unit tests, so later windows start from safe defaults.
 */
export function createHubWindowOptions(
  input: HubWindowOptionsInput,
): BrowserWindowConstructorOptions {
  const options: BrowserWindowConstructorOptions = {
    title: "Murmur",
    width: 1120,
    height: 720,
    minWidth: HUB_MIN_WIDTH,
    minHeight: HUB_MIN_HEIGHT,
    show: false,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: input.isDevelopment,
    },
  };

  if (input.platform === "darwin") {
    options.titleBarStyle = "hiddenInset";
    options.trafficLightPosition = { x: 16, y: 16 };
  }

  return options;
}
