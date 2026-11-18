/**
 * HB-25: a small accessibility check for rendered pages, written for Murmur's tests. It finds
 * controls without a name, images without alt text, positive tab orders, repeated ids and
 * headings that skip a level going down. It does not replace a manual pass with VoiceOver.
 */

const INTERACTIVE = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="textbox"]',
].join(",");

function textOf(element: Element | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The accessible name, roughly as a browser works it out. */
export function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(element.ownerDocument.getElementById(id)))
      .join(" ")
      .trim();
    if (text) return text;
  }
  const label = element.getAttribute("aria-label")?.trim();
  if (label) return label;
  const id = element.getAttribute("id");
  if (id) {
    const forLabel = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (textOf(forLabel)) return textOf(forLabel);
  }
  const wrapping = element.closest("label");
  if (wrapping && textOf(wrapping)) return textOf(wrapping);
  const title = element.getAttribute("title")?.trim();
  if (title) return title;
  if (element instanceof HTMLInputElement && ["button", "submit"].includes(element.type)) {
    return element.value.trim();
  }
  return textOf(element);
}

function isHidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return true;
  }
  return false;
}

export function auditAccessibility(root: HTMLElement): string[] {
  const problems: string[] = [];
  for (const element of root.querySelectorAll(INTERACTIVE)) {
    if (isHidden(element)) continue;
    if (!accessibleName(element)) {
      problems.push(
        `no name: <${element.tagName.toLowerCase()}> ${element.outerHTML.slice(0, 120)}`,
      );
    }
  }
  for (const image of root.querySelectorAll("img")) {
    if (!image.hasAttribute("alt")) problems.push(`no alt: ${image.outerHTML.slice(0, 120)}`);
  }
  for (const element of root.querySelectorAll("[tabindex]")) {
    if (Number(element.getAttribute("tabindex")) > 0) {
      problems.push(`positive tabindex: ${element.outerHTML.slice(0, 120)}`);
    }
  }
  const seen = new Map<string, number>();
  for (const element of root.querySelectorAll("[id]")) {
    seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
  }
  for (const [id, count] of seen) if (count > 1) problems.push(`id used ${count} times: ${id}`);
  let level = 0;
  for (const heading of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const next = Number(heading.tagName[1]);
    if (level > 0 && next > level + 1) {
      problems.push(`heading skips from h${level} to h${next}: ${textOf(heading)}`);
    }
    level = next;
  }
  return problems;
}
