import type { MurmurFocusApi } from "@murmur/shared";

declare global {
  interface Window {
    /** Narrow API exposed by the Focus overlay preload. Missing outside the app. */
    murmurFocus?: MurmurFocusApi;
  }
}

export {};
