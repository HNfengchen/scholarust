import type { TextItem } from "./types";

export interface TextLine {
  x: number;
  top: number;
  size: number;
  text: string;
}

export interface TextParagraph {
  x: number;
  top: number;
  size: number;
  text: string;
}

export function itemsToLines(items: TextItem[]): TextLine[] {
  const lines: TextLine[] = [];
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  const groups: { line: TextLine; parts: TextItem[] }[] = [];
  for (const item of sorted) {
    if (!item.str.trim()) continue;
    const tolerance = Math.max(1, item.size * 0.4);
    let group = groups.find((g) => Math.abs(g.line.top - item.top) <= tolerance);
    if (!group) {
      group = { line: { x: item.x, top: item.top, size: item.size, text: "" }, parts: [] };
      groups.push(group);
    }
    group.parts.push(item);
    group.line.x = Math.min(group.line.x, item.x);
    group.line.size = Math.max(group.line.size, item.size);
  }
  for (const group of groups) {
    group.parts.sort((a, b) => a.x - b.x);
    let text = "";
    for (const part of group.parts) {
      if (text && !/\s$/.test(text) && !/^\s/.test(part.str)) text += " ";
      text += part.str;
    }
    group.line.text = text.trim();
    if (group.line.text) lines.push(group.line);
  }
  lines.sort((a, b) => a.top - b.top);
  return lines;
}

export function groupParagraphs(
  lines: TextLine[],
  regionLeft: number,
  bodySize: number,
): TextParagraph[] {
  const sorted = [...lines].sort((a, b) => a.top - b.top);
  const paragraphs: TextParagraph[] = [];
  let previous: TextLine | null = null;
  for (const line of sorted) {
    const startsNew =
      previous === null ||
      line.top - previous.top > previous.size * 1.45 ||
      (line.x > regionLeft + bodySize * 1.5 && /[.!?。！？]$/.test(previous.text));
    if (startsNew || paragraphs.length === 0) {
      paragraphs.push({ x: line.x, top: line.top, size: line.size, text: line.text });
    } else {
      const paragraph = paragraphs[paragraphs.length - 1];
      if (/[A-Za-z]-$/.test(paragraph.text) && /^[a-z]/.test(line.text)) {
        paragraph.text = paragraph.text.slice(0, -1) + line.text;
      } else {
        paragraph.text += ` ${line.text}`;
      }
      paragraph.size = Math.max(paragraph.size, line.size);
    }
    previous = line;
  }
  return paragraphs;
}

export function headingLevelForLine(line: TextLine, bodySize: number): number | null {
  if (line.size >= bodySize * 1.6) return 1;
  if (line.size >= bodySize * 1.25) return 2;
  if (line.size >= bodySize * 1.08 && line.text.length < 90) return 3;
  return null;
}