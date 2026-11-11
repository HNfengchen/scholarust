import type { TextLine } from "./types";

export interface ReferenceEntry {
  /** The leading marker as written in the source, e.g. `"[1]"`, `"1."`, `"(3)"`. */
  label: string | null;
  /** The integer parsed from `label`, or null when the entry carries no number. */
  number: number | null;
  /** Entry text with the leading marker stripped (render `label` next to it); continuation lines joined by a space. */
  text: string;
}

const HEADING = /^(references|参考文献|bibliography|works cited|literature cited|引用文献)$/;
const LABEL = /^\s*(\[\d+\]|\d+[.)]|\(\d+\))/;
/** A four-digit number is a year, not a reference number (an APA `(2020).` is not a marker). */
const YEAR_FLOOR = 1000;

/**
 * Locate the reference section of a page.
 *
 * `start` is the index of the heading line itself; `end` is the first following line whose
 * `size >= bodySize * 1.25`, else `lines.length`, and is exclusive.
 * Callers take the entry lines as `lines.slice(start + 1, end)`.
 */
export function findReferenceSection(lines: TextLine[], bodySize: number): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text.trim().toLowerCase().replace(/\s+/g, " ");
    if (HEADING.test(text)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].size >= bodySize * 1.25) {
      end = i;
      break;
    }
  }
  return { start, end };
}

interface Marker {
  /** The marker as written, e.g. `"[1]"`. */
  label: string;
  /** The number the marker carries. */
  number: number;
  /** How much of the line the marker occupies (indent included), so the text can be cut behind it. */
  end: number;
}

/** The entry marker a line carries, or null when it carries none (a year is not a marker). */
function markerOf(text: string): Marker | null {
  const match = LABEL.exec(text);
  if (!match) return null;
  const digits = /(\d+)/.exec(match[0]);
  if (!digits) return null;
  const number = parseInt(digits[1], 10);
  if (number >= YEAR_FLOOR) return null;
  return { label: match[1], number, end: match[0].length };
}

interface Column {
  x: number;
  rows: number[];
}

/** The lines of a section grouped into columns of near-equal x. */
function columnsOf(rows: TextLine[], tol: number): Column[] {
  const columns: Column[] = [];
  rows.forEach((row, i) => {
    const column = columns.find((c) => Math.abs(c.x - row.x) <= tol);
    if (column) column.rows.push(i);
    else columns.push({ x: row.x, rows: [i] });
  });
  return columns;
}

/**
 * The x where the entries of a section start.
 *
 * The entry numbers are the strongest evidence: the column that carries them is the entry
 * column, so a stray line further left cannot pull the margin away from the entries.
 * Without any number the margin falls back to the leftmost column that holds more than one
 * line, because a hanging indent always runs to the *right* of the entry column.
 */
function bodyMarginOf(rows: TextLine[], tol: number): number {
  const columns = columnsOf(rows, tol).sort((a, b) => a.x - b.x);
  const numbered = columns
    .map((column) => ({
      column,
      count: column.rows.filter((i) => markerOf(rows[i].text) !== null).length,
    }))
    .filter((entry) => entry.count > 0);
  if (numbered.length > 0) {
    let best = numbered[0];
    for (const candidate of numbered) {
      if (candidate.count > best.count) best = candidate;
    }
    return best.column.x;
  }
  const solid = columns.find((column) => column.rows.length > 1);
  return (solid ?? columns[0]).x;
}

/**
 * Split the lines of a reference section into entries.
 *
 * The margin (the x where the entries start) is taken from the column that carries the entry
 * numbers, so stray lines to the left of the entries cannot swallow them. Relative to that
 * margin:
 *
 * - the first line of the section always starts an entry;
 * - a line at the margin that carries a number starts a new entry;
 * - a line at the margin without a number starts a new entry only when the previous line was
 *   hanging-indented to the right — otherwise it continues the current entry;
 * - every other line (hanging-indented or left of the margin) continues the current entry.
 *
 * Limit: unnumbered entries that are not hanging-indented cannot be told apart and collapse
 * into a single entry.
 *
 * The number marker is stripped from `text`; callers must render `label` next to `text`.
 */
export function splitReferenceEntries(lines: TextLine[], bodySize: number): ReferenceEntry[] {
  const rows = lines.filter((line) => line.text.trim());
  const entries: ReferenceEntry[] = [];
  if (rows.length === 0) return entries;

  // Columns are grouped tightly; a marker is accepted when it sits within half a body size
  // of the margin, so a number printed slightly right of the entry column keeps its number.
  const colTol = 0.25 * bodySize;
  const markerTol = 0.5 * bodySize;
  const margin = bodyMarginOf(rows, colTol);
  let prevHanging = false;

  for (const row of rows) {
    const atMargin = Math.abs(row.x - margin) <= markerTol;
    // Only a line at the margin can carry the number of an entry; a stray numbered line
    // further left keeps its text as it is.
    const marker = atMargin ? markerOf(row.text) : null;
    const hanging = row.x > margin + 0.5 * bodySize;
    const opener =
      entries.length === 0 ||
      (atMargin && marker !== null) ||
      (atMargin && marker === null && prevHanging);

    if (opener) {
      entries.push({
        label: marker ? marker.label : null,
        number: marker ? marker.number : null,
        text: marker ? row.text.slice(marker.end).trim() : row.text.trim(),
      });
    } else {
      entries[entries.length - 1].text += ` ${row.text.trim()}`;
    }
    prevHanging = hanging;
  }
  return entries;
}

/** Numbered entries first, ascending; unnumbered entries keep their original order behind them. */
export function sortReferenceEntries(entries: ReferenceEntry[]): ReferenceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.number === null && b.number === null) return 0;
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  });
}
