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

/**
 * The left edge where the entry lines of a section start.
 *
 * The dominant (median) start x anchors the guess, so a single stray line or a single
 * hanging-indented continuation cannot define the margin; lines that look like entry starts
 * and sit at that edge refine it.
 */
function bodyMarginOf(lines: TextLine[], bodySize: number): number {
  const xs = lines.map((line) => line.x).sort((a, b) => a - b);
  const dominant = xs[Math.floor(xs.length / 2)];
  const atEdge = (x: number) => x <= dominant + 0.5 * bodySize;
  const labelled = lines.filter((line) => LABEL.test(line.text) && atEdge(line.x));
  if (labelled.length > 0) return Math.min(...labelled.map((line) => line.x));
  const flat = lines.filter((line) => atEdge(line.x));
  if (flat.length > 0) return Math.min(...flat.map((line) => line.x));
  return dominant;
}

/**
 * Split the lines of a reference section into entries.
 *
 * The first line of the section always starts an entry. A line starts a new entry when it
 * carries a label (`[1]`, `1.`, `(3)`) and sits at the body margin, or when it is not indented
 * and the previous line was hanging-indented. A label on an indented line is a continuation,
 * so a wrapped line starting with `2020.` stays inside its entry.
 *
 * Limit: unnumbered entries that are not hanging-indented cannot be told apart and collapse
 * into a single entry.
 *
 * The number marker is stripped from `text`; callers must render `label` next to `text`.
 */
export function splitReferenceEntries(lines: TextLine[], bodySize: number): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  if (lines.length === 0) return entries;
  const bodyLeft = bodyMarginOf(lines, bodySize);
  const indent = bodyLeft + 0.5 * bodySize;
  let prevIndented = false;

  for (const line of lines) {
    if (!line.text.trim()) continue;
    const match = LABEL.exec(line.text);
    const indented = line.x > indent;
    const startsEntry =
      (match !== null && !indented) || entries.length === 0 || (!indented && prevIndented);

    if (startsEntry) {
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
    prevIndented = indented;
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
