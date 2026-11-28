/** What main needs from a window's page to send it events. */
export interface PageContents {
  isDestroyed(): boolean;
  send(channel: string, value: unknown): void;
}

export interface PageWindow {
  readonly webContents: PageContents;
  on(event: "closed", handler: () => void): unknown;
}

export interface HubPage {
  /** Sends events to this window's page from now on, until it closes. */
  follow(window: PageWindow): void;
  /** Sends to the open Hub; nothing happens without one. */
  send(channel: string, value: unknown): void;
}

/** The page of the open Hub window. */
export function createHubPage(): HubPage {
  let current: PageContents | null = null;
  return {
    follow(window) {
      // Kept now: a closed window's `webContents` cannot be read any more.
      const contents = window.webContents;
      current = contents;
      window.on("closed", () => {
        if (current === contents) current = null;
      });
    },
    send(channel, value) {
      if (current && !current.isDestroyed()) current.send(channel, value);
    },
  };
}
