export type CspMode = "production" | "development";

/**
 * Builds the Content-Security-Policy for the Hub renderer.
 *
 * Production: everything comes from the app bundle. No remote origins, no
 * inline script, no eval.
 * Development: adds only what the Vite dev server needs: inline script for the
 * React refresh preamble, inline styles injected by HMR, and loopback HTTP and
 * WebSocket connections. `unsafe-eval` is never allowed.
 */
export function buildCsp(mode: CspMode): string {
  const development = mode === "development";

  const directives: Record<string, string[]> = {
    "default-src": ["'none'"],
    "script-src": development ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    "style-src": development ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'"],
    "connect-src": development
      ? [
          "'self'",
          "http://localhost:*",
          "ws://localhost:*",
          "http://127.0.0.1:*",
          "ws://127.0.0.1:*",
        ]
      : ["'none'"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "worker-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export const CSP_PLACEHOLDER = "<!-- murmur:csp -->";

/** Replaces the placeholder comment in an HTML document with a CSP meta tag. */
export function injectCspMeta(html: string, csp: string): string {
  if (!html.includes(CSP_PLACEHOLDER)) {
    throw new Error("CSP placeholder not found in HTML document");
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  return html.replace(CSP_PLACEHOLDER, meta);
}
