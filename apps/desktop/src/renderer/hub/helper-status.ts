import type { HelperStatus } from "@murmur/shared";

/** One line of text for the Hub describing the helper. */
export function describeHelperStatus(status: HelperStatus): string {
  const detail = status.message ? ` ${status.message}` : "";
  switch (status.state) {
    case "ready":
      return `Helper: ready (version ${status.helperVersion ?? "unknown"})`;
    case "starting":
      return `Helper: starting.${detail}`;
    case "error":
      return `Helper: error.${detail}`;
    case "unavailable":
      return `Helper: unavailable.${detail}`;
    case "stopped":
      return "Helper: stopped";
  }
}
