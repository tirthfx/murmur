import { STRICT_LOCAL_MESSAGE } from "@murmur/shared";

/** Refused by strict local mode (HB-52). */
export class NetworkRefusedError extends Error {
  readonly code = "STRICT_LOCAL";
  constructor() {
    super(STRICT_LOCAL_MESSAGE);
  }
}

export interface NetworkGuard {
  /** Throws when strict local mode is on. Every network use in main calls this first. */
  check(purpose: string): void;
  /** For a renderer request: whether it may go out. Only the local dev server is allowed. */
  allowsUrl(url: string): boolean;
}

/**
 * HB-52: the one gate for network use. The only network use Murmur makes is a model
 * download the user starts; with strict local mode on, it is refused. Renderer requests to
 * anything but the local development server are refused in that mode too.
 */
export function createNetworkGuard(deps: {
  strict: () => boolean;
  logger?: { warn(message: string): void };
}): NetworkGuard {
  return {
    check(purpose) {
      if (!deps.strict()) return;
      deps.logger?.warn(`[network] refused (strict local mode): ${purpose}`);
      throw new NetworkRefusedError();
    },
    allowsUrl(url) {
      if (!deps.strict()) return true;
      try {
        const { hostname, protocol } = new URL(url);
        if (protocol === "file:" || protocol === "devtools:" || protocol === "data:") return true;
        return hostname === "localhost" || hostname === "127.0.0.1";
      } catch {
        return false;
      }
    },
  };
}
