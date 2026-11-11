import type { TextLine } from "./types";

export interface ReferenceEntry {
  /** The leading marker as written in the source, e.g. `"[1]"`, `"1."`, `"(3)"`. */
  label: string | null;
  /** The integer parsed from `label`, or null when the entry carries no number. */
  number: number | null;
  /** Entry text with the leading marker stripped; continuation lines joined by a space. */
  text: string;
}

const HEADING = /^(references|参考文献|bibliography|works cited|literature cited|引用文献)$/;
const LABEL = /^\s*(\[\d+\]|\d+[.)]|\(\d+\))/;

/**
 * Locate the reference section of a page.
 *
 * `start` is the index of the heading line itself; `end` is exclusive and points at the
 * first following line that reads as a heading again (or the end of the page).
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

/** Split the lines of a reference section into entries. */
export function splitReferenceEntries(lines: TextLine[], bodySize: number): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  if (lines.length === 0) return entries;
  const bodyLeft = Math.min(...lines.map((line) => line.x));
  const indent = bodyLeft + 0.5 * bodySize;
  let prevIndented = false;

  for (const line of lines) {
    if (!line.text.trim()) continue;
    const match = LABEL.exec(line.text);
    const indented = line.x > indent;
    const startsEntry = match !== null || entries.length === 0 || (!indented && prevIndented);

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
