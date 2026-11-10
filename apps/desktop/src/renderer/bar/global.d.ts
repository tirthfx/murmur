import type { MurmurBarApi } from "@murmur/shared";

declare global {
  interface Window {
    /** Narrow API exposed by the Bar preload. Missing outside the app. */
    murmurBar?: MurmurBarApi;
  }
}

export {};
