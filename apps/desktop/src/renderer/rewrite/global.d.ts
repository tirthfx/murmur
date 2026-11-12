import type { MurmurRewriteApi } from "@murmur/shared";

declare global {
  interface Window {
    /** Narrow API exposed by the Rewrite panel preload. Missing outside the app. */
    murmurRewrite?: MurmurRewriteApi;
  }
}

export {};
