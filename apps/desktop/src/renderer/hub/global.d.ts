import type { MurmurApi } from "@murmur/shared";

declare global {
  interface Window {
    /** Narrow API exposed by the preload script. */
    murmur: MurmurApi;
  }
}

export {};
