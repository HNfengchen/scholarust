import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Rendition } from "epubjs";

export type BlockKind =
  | "title"
  | "heading"
  | "abstract"
  | "paragraph"
  | "note"
  | "references"
  | "caption"
  | "meta";

export interface StructuredBlock {
  id: number;
  kind: BlockKind;
  text: string;
  page: number | null;
  level: number;
}

export interface DocumentStructure {
  blocks: StructuredBlock[];
  removedLines: number;
}

export type StructureExtractor = () => Promise<DocumentStructure>;

export const CONTENT_KINDS: BlockKind[] = ["title", "heading", "abstract", "paragraph", "note"];

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  title: "标题",
  heading: "章节",
  abstract: "摘要",
  paragraph: "正文",
  note: "注释",
  references: "参考文献",
  caption: "图表",
  meta: "作者信息",
};

type Section = "front" | "abstract" | "body" | "references" | "notes";

const NUMBERING_RE = /^\d+(?:\.\d+)*[.、]?\s+/;
const SECTION_RE =
  /^(abstract|references|bibliography|literature\s+cited|acknowledg(?:e)?ments?|notes?|footnotes?|endnotes?|introduction|conclusions?|discussion|appendix|摘要|参考文献|引用文献|致谢|注释|脚注|引言|绪论|结论|附录)\b/i;
const PAGE_NUMBER_RE =
  /^\s*(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*$|^\s*[-–—.\s]*\d{1,4}[-–—.\s]*$|^\s*[ivxlcdm]{1,7}\s*$/i;
const CAPTION_RE = /^(?:figure|fig\.|table|图|表)\s*\d+/i;
const BOILERPLATE_RE = /^(?:permission to make digital|copyright\s+\d{4}|©|\(c\)\s*\d{4}|arxiv:\d+)/i;
const CODE_LINE_RE = /^\d{1,3}\s+.*[{};=()]/;
const FOOTNOTE_START_RE = /^\s*(?:\d{1,3}[\s.)]|[∗*†‡§¶])\s*\S/;

function stripNumbering(text: string): string {
  return text.replace(NUMBERING_RE, "").replace(/^[IVXLC]+[.)]\s+/, "").trim();
}

/** True section numbers: dotted ("1.", "3.1"), parenthesized ("1)"), or a
 *  small non-leading-zero integer followed by a Capitalized word. Excludes
 *  table codes ("000", "010", "100") and prose references ("754 floating…"). */
function isSectionNumbered(text: string): boolean {
  if (/^\d{1,2}(?:\.\d+)+[.)]?\s+/.test(text)) return true;
  if (/^\d{1,2}[.)]\s+/.test(text)) return true;
  if (/^[1-9]\d?\s+[A-Z\u4e00-\u9fff]/.test(text)) return true;
  return false;
}

function sectionForHeading(text: string): Section | null {
  const t = stripNumbering(text).toLowerCase();
  if (/^abstract\b|^摘要/.test(t)) return "abstract";
  if (/^(references|bibliography|literature\s+cited)\b|^参考文献|^引用文献/.test(t)) return "references";
  if (/^(notes?|footnotes?|endnotes?|acknowledg)/.test(t) || /^(注释|脚注|致谢)/.test(t)) return "notes";
  if (
    /^(introduction|background|related\s+work|method|result|experiment|evaluation|discussion|conclusion|appendix)/.test(t) ||
    /^(引言|绪论|背景|方法|结果|实验|讨论|结论|附录)/.test(t)
  ) {
    return "body";
  }
  return null;
}

function normalizeRunning(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}#]+/gu, " ")
    .trim();
}

function weightedMode(values: { value: number; weight: number }[], bucket: number): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const { value, weight } of values) {
    const key = Math.round(value / bucket) * bucket;
    counts.set(key, (counts.get(key) ?? 0) + weight);
  }
  let best: number | null = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

interface PdfItem {
  x: number;
  y: number;
  size: number;
  width: number;
  str: string;
}

interface PdfLine {
  page: number;
  top: number;
  x: number;
  size: number;
  text: string;
  pageHeight: number;
  column: number;
  colLeft: number;
}

function groupItemsIntoLines(items: PdfItem[]): { y: number; x: number; size: number; text: string }[] {
  const lines: { y: number; x: number; size: number; text: string }[] = [];
  const sorted = [...items].sort((a, b) => a.x - b.x);
  for (const item of sorted) {
    const text = item.str;
    if (!text.trim()) continue;
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(1, item.size * 0.4));
    if (!line) {
      line = { y: item.y, x: item.x, size: item.size, text: "" };
      lines.push(line);
    }
    if (line.text && !/\s$/.test(line.text) && !/^\s/.test(text)) line.text += " ";
    line.text += text;
    line.x = Math.min(line.x, item.x);
    line.size = Math.max(line.size, item.size);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/** Two strong x-start clusters separated by a gutter → two-column page. */
function detectColumnBoundary(items: PdfItem[], pageWidth: number): number | null {
  const body = items.filter((item) => item.str.trim() && item.width < pageWidth * 0.6);
  if (body.length < 40) return null;
  const hist = new Map<number, number>();
  for (const item of body) {
    const key = Math.round(item.x / 3) * 3;
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  let leftX: number | null = null;
  let leftCount = 0;
  for (const [x, count] of hist) {
    if (x < pageWidth * 0.4 && count > leftCount) {
      leftX = x;
      leftCount = count;
    }
  }
  if (leftX === null || leftCount / body.length < 0.15) return null;
  let rightX: number | null = null;
  let rightCount = 0;
  for (const [x, count] of hist) {
    if (x > leftX + pageWidth * 0.28 && x < pageWidth * 0.75 && count > rightCount) {
      rightX = x;
      rightCount = count;
    }
  }
  if (rightX === null || rightCount / body.length < 0.15) return null;
  return rightX - 8;
}

async function collectPdfLines(doc: PDFDocumentProxy): Promise<PdfLine[]> {
  const lines: PdfLine[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      items.push({
        x: item.transform[4],
        y: item.transform[5],
        size: Math.abs(item.transform[3]) || item.height || 10,
        width: Math.abs(item.width),
        str: item.str,
      });
    }
    const boundary = detectColumnBoundary(items, base.width);
    const groups: PdfItem[][] = boundary
      ? [
          items.filter((item) => item.x < boundary),
          items.filter((item) => item.x >= boundary),
        ]
      : [items];
    groups.forEach((group, column) => {
      const rawLines = groupItemsIntoLines(group);
      const colLeft =
        weightedMode(
          rawLines.filter((l) => l.text.trim().length >= 10).map((l) => ({ value: l.x, weight: 1 })),
          2,
        ) ?? 0;
      for (const line of rawLines) {
        const text = line.text.trim();
        if (text) {
          lines.push({
            page: pageNumber,
            top: base.height - line.y,
            x: line.x,
            size: line.size,
            text,
            pageHeight: base.height,
            column,
            colLeft,
          });
        }
      }
    });
  }
  return lines;
}

function filterRunningLines(lines: PdfLine[], numPages: number): { kept: PdfLine[]; removed: number } {
  const inZone = (line: PdfLine) =>
    line.top < line.pageHeight * 0.09 || line.top + line.size > line.pageHeight * 0.92;
  const occurrences = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!inZone(line)) continue;
    const key = normalizeRunning(line.text);
    if (!key) continue;
    let pages = occurrences.get(key);
    if (!pages) {
      pages = new Set();
      occurrences.set(key, pages);
    }
    pages.add(line.page);
  }
  const threshold = Math.max(2, Math.ceil(numPages * 0.4));
  const running = new Set<string>();
  for (const [key, pages] of occurrences) {
    if (pages.size >= threshold) running.add(key);
  }
  let removed = 0;
  const kept = lines.filter((line) => {
    if (!inZone(line)) return true;
    const key = normalizeRunning(line.text);
    if (running.has(key) || PAGE_NUMBER_RE.test(line.text)) {
      removed++;
      return false;
    }
    return true;
  });
  return { kept, removed };
}

function headingLevel(line: PdfLine, bodySize: number): number | null {
  const text = line.text;
  if (text.length > 160) return null;
  if (/[{};=<>|\\]/.test(text)) return null;
  if (/^\d+\s+(?:for|if|while|var|let|return|else|continue|break|function|def|class|import)\b/.test(text)) return null;
  const stripped = stripNumbering(text);
  const numbered = isSectionNumbered(text) && stripped.length > 0 && stripped.length < 100;
  const keyword = SECTION_RE.test(stripped);
  const allCaps = /^[A-Z][A-Z\s\d:,&-]{4,80}$/.test(text);
  if (line.size >= bodySize * 1.6) return 1;
  if (line.size >= bodySize * 1.25) return 2;
  if (line.size >= bodySize * 1.08 && (numbered || keyword || allCaps)) return 3;
  if (line.size >= bodySize * 0.96 && (numbered || keyword) && text.length < 90) return 3;
  return null;
}

export async function extractPdfStructure(doc: PDFDocumentProxy): Promise<DocumentStructure> {
  const all = await collectPdfLines(doc);
  const { kept: lines, removed } = filterRunningLines(all, doc.numPages);
  const bodySize =
    weightedMode(
      lines
        .filter((line) => line.text.length >= 20)
        .map((line) => ({ value: line.size, weight: line.text.length })),
      0.5,
    ) ?? 10;

  const blocks: StructuredBlock[] = [];
  let nextId = 0;
  let section: Section = "front";
  let buffer: { kind: BlockKind; text: string; page: number; size: number; code: boolean } | null = null;
  let previous: PdfLine | null = null;

  const flush = () => {
    if (!buffer) return;
    const text = buffer.text.trim();
    if (text) {
      blocks.push({ id: nextId++, kind: buffer.kind, text, page: buffer.page, level: 0 });
    }
    buffer = null;
  };

  const kindForLine = (line: PdfLine): BlockKind => {
    if (BOILERPLATE_RE.test(line.text)) return "meta";
    if (CAPTION_RE.test(line.text)) return "caption";
    if (
      line.top > line.pageHeight * 0.84 &&
      line.size <= bodySize * 0.9 &&
      FOOTNOTE_START_RE.test(line.text)
    ) {
      return "note";
    }
    switch (section) {
      case "abstract":
        return "abstract";
      case "references":
        return "references";
      case "notes":
        return "note";
      case "front":
        return "meta";
      default:
        return "paragraph";
    }
  };

  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    const closeToPrevious =
      previous !== null &&
      line.page === previous.page &&
      line.column === previous.column &&
      line.top - previous.top < previous.size * 1.8;

    if (last && last.kind === "title" && section === "front" && line.page === 1 && line.size >= bodySize * 1.3 && closeToPrevious) {
      last.text += ` ${line.text}`;
      previous = line;
      continue;
    }
    if (last && last.kind === "heading" && line.size >= bodySize * 1.2 && closeToPrevious) {
      last.text += ` ${line.text}`;
      previous = line;
      continue;
    }

    const level = headingLevel(line, bodySize);
    if (level !== null) {
      flush();
      const isTitle = blocks.length === 0 && line.page === 1 && line.size >= bodySize * 1.3;
      if (isTitle) {
        blocks.push({ id: nextId++, kind: "title", text: line.text, page: line.page, level: 0 });
      } else {
        blocks.push({ id: nextId++, kind: "heading", text: line.text, page: line.page, level });
        const matched = sectionForHeading(line.text);
        if (matched) section = matched;
        else if (section === "front" || section === "abstract") section = "body";
      }
      previous = line;
      continue;
    }

    const kind = kindForLine(line);
    if (buffer && previous) {
      const samePage = line.page === previous.page;
      const sameColumn = line.column === previous.column;
      const gap = line.top - previous.top;
      const sizeJump = Math.abs(line.size - buffer.size) > bodySize * 0.18;
      const lineIsCode = CODE_LINE_RE.test(line.text);
      const codeContinuation = buffer.code && lineIsCode && samePage && sameColumn && gap <= previous.size * 1.75;
      const indentedStart = line.x > line.colLeft + bodySize * 1.05 && !codeContinuation;
      const referenceEntryStart =
        buffer.kind === "references" &&
        (line.x < line.colLeft + bodySize * 0.6 || /^\[\d+\]/.test(line.text));
      const crossPage = !samePage;
      const crossColumn = samePage && !sameColumn;
      const continues =
        (crossPage || crossColumn) &&
        buffer.kind === kind &&
        !/[.!?。！？:：;；]\s*$/.test(buffer.text) &&
        Math.abs(line.size - bodySize) <= bodySize * 0.15 &&
        Math.abs(line.x - line.colLeft) <= bodySize * 1.5;
      const breaks =
        !continues &&
        (kind !== buffer.kind ||
          sizeJump ||
          referenceEntryStart ||
          crossColumn ||
          (samePage && sameColumn && gap > previous.size * 1.75) ||
          (samePage && sameColumn && indentedStart && buffer.kind !== "references"));
      if (breaks) {
        flush();
      } else {
        if (/[A-Za-z]-$/.test(buffer.text) && /^[a-z]/.test(line.text)) {
          buffer.text = buffer.text.slice(0, -1) + line.text;
        } else {
          buffer.text += ` ${line.text}`;
        }
        previous = line;
        continue;
      }
    }
    buffer = { kind, text: line.text, page: line.page, size: line.size, code: CODE_LINE_RE.test(line.text) };
    previous = line;
  }
  flush();

  return { blocks, removedLines: removed };
}

const HTML_BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figcaption,aside";
const FOOTNOTE_SELECTOR =
  '[epub\\:type~="footnote"],[epub\\:type~="rearnote"],[role="doc-footnote"],[role="doc-endnote"],.footnote,.footnotes,#footnotes';

export function extractHtmlStructure(root: ParentNode): DocumentStructure {
  const matched = Array.from(root.querySelectorAll<HTMLElement>(HTML_BLOCK_SELECTOR));
  const topLevel = matched.filter(
    (element) => !matched.some((other) => other !== element && other.contains(element)),
  );
  const blocks: StructuredBlock[] = [];
  let nextId = 0;
  let section: Section = "body";
  let titleSeen = false;
  for (const element of topLevel) {
    const text = (element.innerText || element.textContent || "").trim();
    if (!text) continue;
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const isTitle = !titleSeen && level === 1;
      if (isTitle) titleSeen = true;
      blocks.push({
        id: nextId++,
        kind: isTitle ? "title" : "heading",
        text,
        page: null,
        level: isTitle ? 0 : level,
      });
      const matchedSection = sectionForHeading(text);
      if (matchedSection) section = matchedSection;
      else if (section === "abstract") section = "body";
      continue;
    }
    let kind: BlockKind;
    if (element.closest(FOOTNOTE_SELECTOR) || tag === "aside") kind = "note";
    else if (tag === "figcaption" || CAPTION_RE.test(text)) kind = "caption";
    else if (section === "abstract") kind = "abstract";
    else if (section === "references") kind = "references";
    else if (section === "notes") kind = "note";
    else kind = "paragraph";
    blocks.push({ id: nextId++, kind, text, page: null, level: 0 });
  }
  return { blocks, removedLines: 0 };
}

export function extractEpubStructure(rendition: Rendition): DocumentStructure {
  const contents = rendition.getContents();
  const first = Array.isArray(contents) ? contents[0] : contents;
  const document = first?.document;
  if (!document) return { blocks: [], removedLines: 0 };
  return extractHtmlStructure(document);
}