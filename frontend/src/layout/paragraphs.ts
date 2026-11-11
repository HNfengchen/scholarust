import type { TextLine } from "./types";

const TERMINAL_PUNCT = /[.!?。！？:：]$/;
const LIST_MARKER = /^\s*([-•*▪]|\d+[.)])\s+/;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)[.、]?\s+(\S[\s\S]*)$/;
const LEADS_WITH_LETTER = /^[A-Z\u4e00-\u9fff]/;

/** Share of words that start with a capital letter or a CJK character. */
function titleCaseRatio(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  return words.filter((word) => LEADS_WITH_LETTER.test(word)).length / words.length;
}

/** True for a measurement like `0.09` or `1.05`, not a section number like `2.1`. */
function isDecimalNumber(number: string): boolean {
  return number.split(".").some((part) => part === "0" || (part.length > 1 && part.startsWith("0")));
}

/** Most frequent font size (rounded to 0.5), weighted by the characters it carries. */
export function bodySizeOf(lines: TextLine[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const bucket = Math.round(line.size * 2) / 2;
    weights.set(bucket, (weights.get(bucket) ?? 0) + line.text.length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [bucket, weight] of weights) {
    if (weight > bestWeight) {
      best = bucket;
      bestWeight = weight;
    }
  }
  return best;
}

/** Heading level of a line, or null when it reads as body text. */
export function headingLevelForLine(line: TextLine, bodySize: number): number | null {
  const text = line.text.trim();
  if (/^(?:abstract|摘要|references|bibliography|参考文献)[:：]?$/i.test(text)) return 1;
  // A numbered SECTION heading ("2 Process Flow", "2.1 Shape") reads like a title:
  // short, capitalised, no sentence punctuation. A numbered list item
  // ("1. Starting position: the clamp…"), a table row ("65 0.33") or author
  // superscripts ("1 1 2 3") are not headings, so the tail must pass these checks.
  const numbered = NUMBERED_HEADING.exec(text);
  if (numbered && !isDecimalNumber(numbered[1])) {
    const tail = numbered[2];
    if (
      tail.length <= 80 &&
      LEADS_WITH_LETTER.test(tail) &&
      !/[:;：；]/.test(tail) &&
      !TERMINAL_PUNCT.test(tail) &&
      (numbered[1].includes(".") || titleCaseRatio(tail) >= 0.6)
    ) {
      return numbered[1].split(".").length;
    }
  }
  if (bodySize <= 0) return null;
  // An unnumbered heading stands out by size and still has to read like a title,
  // not a number or a full sentence (table cells are often set large).
  if (!LEADS_WITH_LETTER.test(text) || TERMINAL_PUNCT.test(text)) return null;
  if (line.size >= bodySize * 1.6) return 1;
  if (line.size >= bodySize * 1.25) return 2;
  if (line.size >= bodySize * 1.1 && text.length < 90) return 3;
  return null;
}

/** True for plain list markers (`-`, `•`, `*`, `▪`, `1.`, `1)`). */
export function isListItem(line: TextLine): boolean {
  return LIST_MARKER.test(line.text);
}

/** Group consecutive lines into paragraphs, joining wrapped lines and hyphenated breaks. */
export function mergeLinesIntoParagraphs(lines: TextLine[], bodySize: number): TextLine[][] {
  const groups: TextLine[][] = [];
  let current: TextLine[] = [];
  for (const line of lines) {
    const prev = current[current.length - 1];
    if (prev) {
      const gap = line.baseline - prev.baseline;
      const indent = line.x - prev.x;
      if (
        gap < -0.5 * prev.size ||
        gap > 1.5 * prev.size ||
        (TERMINAL_PUNCT.test(prev.text) && indent > 1.5 * prev.size) ||
        headingLevelForLine(line, bodySize) !== null ||
        isListItem(line)
      ) {
        groups.push(current);
        current = [];
      }
    }
    const last = current[current.length - 1];
    if (last && last.text.endsWith("-") && /^[a-z]/.test(line.text)) {
      current[current.length - 1] = {
        x: last.x,
        baseline: line.baseline,
        width: last.width + line.width,
        size: Math.max(last.size, line.size),
        text: last.text.slice(0, -1) + line.text,
      };
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
