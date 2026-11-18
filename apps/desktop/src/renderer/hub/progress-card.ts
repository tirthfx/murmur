import { PROGRESS_CARD, type ProgressCardContent } from "@murmur/shared";

/**
 * Draws the progress card (HB-44) as a 1200 by 630 PNG in Murmur's own simple design: the
 * milestone, a figure and the date. Only counts and dates are drawn, never dictated text.
 */
export async function renderProgressCard(content: ProgressCardContent): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = PROGRESS_CARD.width;
  canvas.height = PROGRESS_CARD.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  const { width, height } = canvas;

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#1f2937");
  gradient.addColorStop(1, "#111827");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#f9fafb";
  context.textBaseline = "alphabetic";
  context.font = "600 40px system-ui, sans-serif";
  context.fillText("Murmur", 80, 110);

  context.font = "700 84px system-ui, sans-serif";
  context.fillText(content.title, 80, 290, width - 160);

  context.fillStyle = "#d1d5db";
  context.font = "500 48px system-ui, sans-serif";
  context.fillText(content.figure, 80, 380, width - 160);

  context.fillStyle = "#9ca3af";
  context.font = "400 32px system-ui, sans-serif";
  context.fillText(content.date, 80, 520, width - 160);
  context.fillText(content.caption, 80, 566, width - 160);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The card could not be drawn");
  return new Uint8Array(await blob.arrayBuffer());
}
