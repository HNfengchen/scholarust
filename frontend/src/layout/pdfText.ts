import type { PdfJsTextItem, PdfTextItem, TextLine } from "./types";

/** Convert pdf.js text items into page-space items (origin at the page top-left). */
export function itemsFromTextContent(items: PdfJsTextItem[], pageHeight: number): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const item of items) {
    if (!item.str) continue;
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
  const size = Math.max(...ordered.map((i) => i.size));
  const baseline = ordered.reduce((sum, i) => sum + i.baseline, 0) / ordered.length;
  return { x: left, baseline, width: right - left, size, text };
}

/** Group items sharing a baseline into lines, ordered top to bottom. */
export function groupItemsIntoLines(items: PdfTextItem[]): TextLine[] {
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines: TextLine[] = [];
  let row: PdfTextItem[] = [];
  let baselineSum = 0;
  let rowSize = 0;

  for (const item of sorted) {
    if (row.length > 0 && Math.abs(item.baseline - baselineSum / row.length) > Math.max(1, rowSize * 0.35)) {
      lines.push(buildLine(row));
      row = [];
      baselineSum = 0;
      rowSize = 0;
    }
    row.push(item);
    baselineSum += item.baseline;
    rowSize = Math.max(rowSize, item.size);
  }
  if (row.length > 0) lines.push(buildLine(row));
  return lines;
}
