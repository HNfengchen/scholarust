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

/** The x of the next line that starts in another column, or null when there is none. */
function nextColumnX(rows: TextLine[], from: number, tol: number): number | null {
  for (let j = from + 1; j < rows.length; j++) {
    if (Math.abs(rows[j].x - rows[from].x) > tol) return rows[j].x;
  }
  return null;
}

/** The lines of a section grouped into columns of near-equal x. */
function columnsOf(rows: TextLine[], tol: number): { x: number; lines: number[] }[] {
  const columns: { x: number; lines: number[] }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const column = columns.find((c) => Math.abs(c.x - rows[i].x) <= tol);
    if (column) column.lines.push(i);
    else columns.push({ x: rows[i].x, lines: [i] });
  }
  return columns;
}

/**
 * The left edge where the entry lines of a section start.
 *
 * A column whose lines step back to the left is a hanging indent, not the margin. Among the
 * remaining columns the one that carries the entry numbers wins — but only with two or more
 * of them, a single one is more likely a wrapped year such as `2020.` — otherwise the widest
 * column wins, so stray lines further left cannot pull the margin away from the entries.
 */
function bodyMarginOf(rows: TextLine[], tol: number): number {
  const columns = columnsOf(rows, tol);
  const entryColumns = columns.filter(
    (column) =>
      !column.lines.some((i) => {
        const next = nextColumnX(rows, i, tol);
        return next !== null && next < rows[i].x - tol;
      }),
  );
  const pool = entryColumns.length > 0 ? entryColumns : columns;
  const labelCount = (column: { lines: number[] }) =>
    column.lines.filter((i) => LABEL.test(rows[i].text)).length;
  const labelled = pool.filter((column) => labelCount(column) >= 2);
  const chosen = labelled.length > 0 ? labelled : pool;
  let best = chosen[0];
  for (const column of chosen) if (column.lines.length > best.lines.length) best = column;
  return best.x;
}

/** True when the next line in another column steps back to the margin: this line is a continuation. */
function stepsBackToMargin(
  rows: TextLine[],
  i: number,
  margin: number,
  bodySize: number,
  tol: number,
): boolean {
  const next = nextColumnX(rows, i, tol);
  return next !== null && next < rows[i].x - tol && Math.abs(next - margin) <= 0.5 * bodySize;
}

/**
 * Split the lines of a reference section into entries.
 *
 * The first line of the section always starts an entry. A line starts a new entry when it
 * carries a label (`[1]`, `1.`, `(3)`) and sits at the inferred body margin without stepping
 * back to it, or when it is unlabelled, at the margin, and follows a hanging-indented line.
 * A labelled line that steps back to the margin is a continuation, so a wrapped line starting
 * with `2020.` stays inside its entry.
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

  const tol = 0.25 * bodySize;
  const margin = bodyMarginOf(rows, tol);
  let prevHanging = false;

  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const match = LABEL.exec(line.text);
    const hanging = line.x > margin + 0.5 * bodySize;
    const opener =
      entries.length === 0 ||
      (match !== null && !hanging && !stepsBackToMargin(rows, i, margin, bodySize, tol)) ||
      (match === null && !hanging && prevHanging);

    if (opener) {
      const label = match ? match[0].trim() : null;
      const digits = label ? /(\d+)/.exec(label) : null;
      entries.push({
        label,
        number: digits ? parseInt(digits[1], 10) : null,
        text: match ? line.text.slice(match[0].length).trim() : line.text.trim(),
      });
    } else {
      entries[entries.length - 1].text += ` ${line.text.trim()}`;
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
