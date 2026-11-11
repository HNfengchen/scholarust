import { groupItemsIntoLines } from "./pdfText";
import type { PdfTextItem, TextLine } from "./pdfText";
import type { LayoutRect } from "./types";

export interface GutterResult {
  gutter: [number, number] | null;
  spanning: Set<number>;
}

/** Median font size of all items, rounded to the nearest 0.5pt. */
function medianSize(items: PdfTextItem[]): number {
  const sizes = items.map((i) => i.size).sort((a, b) => a - b);
  const mid = sizes.length >> 1;
  const median = sizes.length % 2 ? sizes[mid] : (sizes[mid - 1] + sizes[mid]) / 2;
  return Math.round(median * 2) / 2;
}

/**
 * Find the vertical gutter between two text columns.
 *
 * A 1pt coverage histogram over the page width counts how many body items cover
 * each x bin. A gutter is a wide vertical white space between two text blocks:
 * the widest such run wins. A title that spans the gutter covers only a few
 * bins, so the gap is looked for at several sparsity levels and stays
 * detectable.
 */
export function detectGutter(
  items: PdfTextItem[],
  pageWidth: number,
  pageHeight: number,
  bodySize?: number,
): GutterResult {
  const none: GutterResult = { gutter: null, spanning: new Set() };
  if (items.length === 0 || pageWidth <= 0) return none;

  const size = bodySize ?? medianSize(items);
  const body = items.filter((i) => i.baseline >= 0.08 * pageHeight && i.baseline <= 0.92 * pageHeight);
  if (body.length === 0) return none;

  const bins = Math.max(1, Math.ceil(pageWidth));
  const coverage = new Array<number>(bins).fill(0);
  for (const item of body) {
    const from = Math.max(0, Math.floor(item.x));
    const to = Math.min(bins - 1, Math.ceil(item.x + item.width) - 1);
    for (let b = from; b <= to; b++) coverage[b]++;
  }

  let maxCoverage = 0;
  for (const c of coverage) if (c > maxCoverage) maxCoverage = c;

  // A title spanning the gutter covers only a few bins, so the gap stays sparse
  // instead of empty; but the gap is never as dense as the text block itself,
  // otherwise the word spacing of a single-column page looks like a gutter.
  const gapThreshold = Math.min(Math.max(1, Math.floor(0.15 * maxCoverage)), maxCoverage - 1);

  // The gap is looked for at every sparsity level, so a title crossing it does
  // not split it into two halves. The widest run flanked by denser text wins.
  let best: [number, number] | null = null;
  for (let level = 0; level <= gapThreshold; level++) {
    let b = 0;
    while (b < bins) {
      if (coverage[b] <= level) {
        const start = b;
        while (b + 1 < bins && coverage[b + 1] <= level) b++;
        const end = b;
        // A gutter has dense text on both sides; a page margin has none.
        const left = start > 0 ? coverage[start - 1] : 0;
        const right = end + 1 < bins ? coverage[end + 1] : 0;
        if (left > level && right > level && (!best || end - start > best[1] - best[0])) {
          best = [start, end];
        }
      }
      b++;
    }
  }

  const minGap = Math.max(0.02 * pageWidth, 1.2 * size);
  if (!best || best[1] - best[0] + 1 < minGap) return none;

  const g0 = best[0];
  const g1 = best[1] + 1;
  const spanning = new Set<number>();
  items.forEach((item, index) => {
    if (item.x < g1 && item.x + item.width > g0) spanning.add(index);
  });
  return { gutter: [g0, g1], spanning };
}

/** The lines of one page, split into the columns they belong to. */
export interface OrderedColumns {
  /** The gutter between the columns, or null for a single-column page. */
  gutter: [number, number] | null;
  /** Lines that cross the gutter (titles, figures). */
  spanning: TextLine[];
  /** The lines of the left column. */
  left: TextLine[];
  /** The lines of the right column. */
  right: TextLine[];
}

/**
 * Split the text of one page into its columns.
 *
 * The split is the same one `orderPageLines` reads by, but kept apart so that
 * other elements (images) can be placed in the column they belong to.
 */
export function orderPageColumns(
  items: PdfTextItem[],
  pageWidth: number,
  pageHeight: number,
  bodySize?: number,
  detectedGutter?: [number, number],
  spanningRegions: LayoutRect[] = [],
): OrderedColumns {
  const gutter = detectedGutter ?? detectGutter(items, pageWidth, pageHeight, bodySize).gutter;
  if (!gutter) {
    return { gutter: null, spanning: [], left: groupItemsIntoLines(items), right: [] };
  }

  const [g0, g1] = gutter;
  const left: PdfTextItem[] = [];
  const right: PdfTextItem[] = [];
  const across: PdfTextItem[] = [];
  for (const item of items) {
    const cy = item.baseline - item.size / 2;
    if (spanningRegions.some((r) => cy >= r.y && cy <= r.y + r.h)) across.push(item);
    else if (item.x + item.width <= g0) left.push(item);
    else if (item.x >= g1) right.push(item);
    else across.push(item);
  }

  return {
    gutter,
    spanning: groupItemsIntoLines(across),
    left: groupItemsIntoLines(left),
    right: groupItemsIntoLines(right),
  };
}

/**
 * Order the text of one page into reading order: spanning items (titles) and
 * the left column interleaved by baseline, then the right column.
 */
export function orderPageLines(
  items: PdfTextItem[],
  pageWidth: number,
  pageHeight: number,
  bodySize?: number,
): TextLine[] {
  const { spanning, left, right } = orderPageColumns(items, pageWidth, pageHeight, bodySize);
  const head = [...spanning, ...left].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  return [...head, ...right];
}
