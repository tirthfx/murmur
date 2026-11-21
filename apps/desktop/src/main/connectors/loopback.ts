import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RedirectResult =
  | { ok: true; code: string }
  | {
      ok: false;
      reason: "denied" | "state" | "timeout" | "cancelled";
      /** In plain words, for the Connectors page. */
      message: string;
    };

export interface Loopback {
  /** `http://127.0.0.1:<port><path>`: what the provider redirects to. */
  redirectUri: string;
  /**
   * Resolves with the first request to the callback path: the code when `state` matches, else why
   * not. The listener closes after that request, after the timeout, or when `close` is called.
   */
  wait(state: string): Promise<RedirectResult>;
  close(): void;
}

export const LOOPBACK_TIMEOUT_MS = 5 * 60_000;

const PAGES = {
  done: "You are signed in. You can close this tab and go back to Murmur.",
  failed: "The sign-in did not finish. You can close this tab and try again in Murmur.",
};

const page = (text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Murmur</title>` +
  `<body style="font:16px system-ui;margin:3rem auto;max-width:28rem"><p>${text}</p></body>`;

/**
 * A short-lived HTTP listener on 127.0.0.1 that catches the provider's redirect (CN-01). It takes
 * one request to the callback path; anything else gets a 404 and is ignored. `port` is 0 to
 * let the system choose, or a fixed number for providers that need an exact redirect address.
 */
export function startLoopback(options: {
  port: number;
  path: string;
  timeoutMs?: number;
  /**
   * The host named in the redirect address. The listener is on 127.0.0.1 either way; some
   * providers (Microsoft) register `localhost` for a loopback redirect. Default `127.0.0.1`.
   */
  redirectHost?: "127.0.0.1" | "localhost";
}): Promise<Loopback> {
  const timeoutMs = options.timeoutMs ?? LOOPBACK_TIMEOUT_MS;
  return new Promise((resolveStart, rejectStart) => {
    let settle: (result: RedirectResult) => void = () => undefined;
    let expected: string | null = null;
    let pending: RedirectResult | null = null;
    const done = new Promise<RedirectResult>((resolve) => {
      settle = (result) => {
        pending ??= result;
        resolve(pending);
      };
    });

    const server: Server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET" || url.pathname !== options.path) {
        response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      let result: RedirectResult;
      if (expected === null || state !== expected) {
        result = {
          ok: false,
          reason: "state",
          message: "The answer did not match this sign-in, so it was ignored. Try again.",
        };
      } else if (error !== null) {
        // The provider's own words, when it gives them: they say what to fix (a work account that
        // needs an administrator's consent, say).
        const detail = (url.searchParams.get("error_description") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300);
        result = {
          ok: false,
          reason: "denied",
          message:
            error === "access_denied" && detail === ""
              ? "The sign-in was not allowed."
              : detail !== ""
                ? `The provider refused the sign-in: ${detail}`
                : `The provider refused the sign-in (${error.slice(0, 80)}).`,
        };
      } else if (code === null || code === "") {
        result = { ok: false, reason: "denied", message: "The provider sent no sign-in code." };
      } else {
        result = { ok: true, code };
      }
      response
        .writeHead(result.ok ? 200 : 400, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          connection: "close",
        })
        .end(page(result.ok ? PAGES.done : PAGES.failed));
      settle(result);
      close();
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    function close() {
      if (timer) clearTimeout(timer);
      timer = null;
      server.close();
      server.closeAllConnections();
    }

    server.once("error", (error: NodeJS.ErrnoException) => {
      rejectStart(
        new Error(
          error.code === "EADDRINUSE"
            ? `Port ${options.port} is in use, so Murmur cannot catch the sign-in. Close what uses it and try again.`
            : `Murmur could not listen for the sign-in (${error.code ?? "error"}).`,
        ),
      );
    });
    server.listen(options.port, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      timer = setTimeout(() => {
        settle({
          ok: false,
          reason: "timeout",
          message: "The sign-in was not finished in 5 minutes.",
        });
        close();
      }, timeoutMs);
      resolveStart({
        redirectUri: `http://${options.redirectHost ?? "127.0.0.1"}:${port}${options.path}`,
        wait(state) {
          expected = state;
          return done;
        },
        close() {
          settle({ ok: false, reason: "cancelled", message: "The sign-in was cancelled." });
          close();
        },
      });
    });
  });
}
