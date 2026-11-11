import type { TextLine } from "./types";

const TERMINAL_PUNCT = /[.!?。！？:：]$/;
const LIST_MARKER = /^\s*([-•*▪]|\d+[.)])\s+/;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)[.、\s]/;

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
  const numbered = NUMBERED_HEADING.exec(line.text);
  if (numbered && line.text.length < 120) return numbered[1].split(".").length;
  if (bodySize <= 0) return null;
  if (line.size >= bodySize * 1.6) return 1;
  if (line.size >= bodySize * 1.25) return 2;
  if (line.size >= bodySize * 1.1 && line.text.length < 90) return 3;
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
