import type { BarIcon } from "./bar-text";

const paths: Record<Exclude<BarIcon, "spinner">, string> = {
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm-6 8a6 6 0 0 0 12 0M12 17v4m-3 0h6",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 4l9 16H3zM12 10v4m0 3v.01",
  retry: "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5",
  cancel: "M6 6l12 12M18 6L6 18",
};

/** Simple line icons drawn for Murmur. `data-icon` names the icon for tests. */
export function Icon({ name }: { name: BarIcon }) {
  if (name === "spinner") {
    return (
      <svg
        className="bar-icon bar-spinner"
        data-icon="spinner"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="8" fill="none" strokeWidth="2.5" opacity="0.25" />
        <path d="M12 4a8 8 0 0 1 8 8" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="bar-icon" data-icon={name} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={paths[name]}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
