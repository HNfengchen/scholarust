import type { PdfJsTextItem, PdfTextItem, TextLine } from "./types";

export type { PdfTextItem, TextLine };

/** Convert pdf.js text items into page-space items (origin at the page top-left). */
export function itemsFromTextContent(items: PdfJsTextItem[], pageHeight: number): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const t = item.transform;
    out.push({
      x: t[4],
      baseline: pageHeight - t[5],
      size: Math.abs(t[3]) || item.height,
      width: item.width,
      str: item.str,
    });
  }
  return out;
}

function buildLine(row: PdfTextItem[]): TextLine {
  const ordered = [...row].sort((a, b) => a.x - b.x);
  let text = "";
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    if (i > 0) {
      const prev = ordered[i - 1];
      if (item.x - (prev.x + prev.width) > 0.25 * item.size) text += " ";
    }
    text += item.str;
  }
  const left = Math.min(...ordered.map((i) => i.x));
  const right = Math.max(...ordered.map((i) => i.x + i.width));
  const weight = ordered.reduce((sum, item) => sum + item.str.length, 0);
  const size = ordered.reduce((sum, item) => sum + item.size * item.str.length, 0) / weight;
  const baseline = ordered.reduce((sum, i) => sum + i.baseline, 0) / ordered.length;
  return { x: left, baseline, width: right - left, size, text };
}

/** Group items sharing a baseline into lines, ordered top to bottom. */
export function groupItemsIntoLines(items: PdfTextItem[]): TextLine[] {
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines: TextLine[] = [];
  let row: PdfTextItem[] = [];
  let rowSize = 0;

  for (const item of sorted) {
    // The row keeps the baseline of its first item as a fixed reference, so the
    // tolerance cannot widen as the row grows.
    if (row.length > 0 && Math.abs(item.baseline - row[0].baseline) > Math.max(1, Math.max(rowSize, item.size) * 0.4)) {
      lines.push(buildLine(row));
      row = [];
      rowSize = 0;
    }
    row.push(item);
    rowSize = Math.max(rowSize, item.size);
  }
  if (row.length > 0) lines.push(buildLine(row));
  return lines;
}
