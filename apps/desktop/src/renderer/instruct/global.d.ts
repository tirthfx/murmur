import type { MurmurInstructApi } from "@murmur/shared";

declare global {
  interface Window {
    /** Narrow API exposed by the Instruct panel preload. Missing outside the app. */
    murmurInstruct?: MurmurInstructApi;
  }
}

export {};
