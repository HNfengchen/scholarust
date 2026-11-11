import type { PDFDocumentProxy } from "pdfjs-dist";
import { itemsFromTextContent } from "./pdfText";
import type { PdfJsTextItem, TextLine } from "./types";
import { orderPageColumns } from "./order";
import type { OrderedColumns } from "./order";
import { bodySizeOf, headingLevelForLine, mergeLinesIntoParagraphs } from "./paragraphs";
import { findReferenceSection, sortReferenceEntries, splitReferenceEntries } from "./references";
import { extractPageImages } from "./pageImages";
import type { PlacedImage } from "./pageImages";
import { sectionForHeading } from "../structure";
import type { BlockKind, DocumentStructure, Section, StructuredBlock } from "../structure";

/** The page-number shapes a running head may carry. */
const PAGE_NUMBER_RE = /^(\d+|\d+\s*\/\s*\d+|[-–—]\s*\d+\s*[-–—]|第\s*\d+\s*页)$/;
/** The share of the page height kept free at the top and at the bottom. */
const BAND_TOP = 0.06;
const BAND_BOTTOM = 0.94;
/** A text must sit on this share of the pages to count as running. */
const RUNNING_RATIO = 0.4;
/** How far below a figure its caption may sit. */
const CAPTION_GAP = 120;
/** A title must stand out this much against the body size. */
const TITLE_FACTOR = 1.3;

const TERMINAL_PUNCT = /[.!?。！？:：]$/;
const CONTINUATION_START = /^[a-z一-鿿]/;

/** The lines of one page, with the height they sit on. */
export interface PageLines {
  pageNumber: number;
  height: number;
  lines: TextLine[];
}

/** Trimmed text with collapsed inner whitespace: the key a running head is judged by. */
export function normalizeRunningText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** True for the page-number shapes a running head may carry. */
export function isPageNumberText(text: string): boolean {
  return PAGE_NUMBER_RE.test(normalizeRunningText(text));
}

/** True when the line sits in the top or the bottom band of the page. */
export function isBandLine(line: TextLine, pageHeight: number): boolean {
  return (
    line.baseline - line.size < BAND_TOP * pageHeight || line.baseline > BAND_BOTTOM * pageHeight
  );
}

/**
 * The texts that sit in the page band on at least 40% of the pages.
 *
 * A running head can only be told from body text once every page has been
 * seen, so the count is made over the whole document.
 */
export function repeatedBandTexts(pages: PageLines[], numPages: number): Set<string> {
  const pagesOf = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.lines) {
      if (!isBandLine(line, page.height)) continue;
      const key = normalizeRunningText(line.text);
      if (!key) continue;
      let numbers = pagesOf.get(key);
      if (!numbers) {
        numbers = new Set();
        pagesOf.set(key, numbers);
      }
      numbers.add(page.pageNumber);
    }
  }
  const threshold = Math.max(1, Math.ceil(numPages * RUNNING_RATIO));
  const repeated = new Set<string>();
  for (const [key, numbers] of pagesOf) {
    if (numbers.size >= threshold) repeated.add(key);
  }
  return repeated;
}

/**
 * True when the line is a running page number that may be dropped.
 *
 * All three conditions have to hold: the line sits in the page band, its text
 * runs on at least 40% of the pages, and it looks like a page number.
 */
export function isRunningNumber(
  line: TextLine,
  pageHeight: number,
  repeated: Set<string>,
): boolean {
  if (!isBandLine(line, pageHeight)) return false;
  const key = normalizeRunningText(line.text);
  return repeated.has(key) && isPageNumberText(key);
}

/**
 * Join a block that continues on the next page into the block before it.
 *
 * A paragraph or a reference entry that does not end in a sentence and is
 * followed by a block that starts lower-case runs across the page break.
 */
export function mergeAcrossPages(blocks: StructuredBlock[]): StructuredBlock[] {
  const merged: StructuredBlock[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.kind === block.kind &&
      (previous.kind === "paragraph" ||
        previous.kind === "meta" ||
        previous.kind === "abstract" ||
        previous.kind === "reference") &&
      previous.page !== null &&
      block.page !== null &&
      previous.page !== block.page &&
      !isPageNumberText(previous.text) &&
      !TERMINAL_PUNCT.test(previous.text.trim()) &&
      CONTINUATION_START.test(block.text.trim())
    ) {
      previous.text = `${previous.text} ${block.text.trim()}`;
      continue;
    }
    merged.push(block);
  }
  return merged;
}

/** The text of a reference entry: the marker is kept, so the reader sees the number. */
export function referenceText(label: string | null, text: string): string {
  return label ? `${label} ${text}` : text;
}

interface PageData {
  pageNumber: number;
  height: number;
  columns: OrderedColumns;
  images: PlacedImage[];
}

type Element = { kind: "line"; line: TextLine } | { kind: "image"; image: PlacedImage };

type PageItem =
  | { kind: "heading"; line: TextLine; level: number }
  | { kind: "paragraph"; lines: TextLine[] }
  | { kind: "meta"; line: TextLine }
  | { kind: "figure"; image: PlacedImage; caption?: string };

interface BuildContext {
  bodySize: number;
  section: Section;
  headingSeen: boolean;
}

/** The lines of a page in reading order: the head first, then the right column. */
function orderedLines(columns: OrderedColumns): TextLine[] {
  const head = [...columns.spanning, ...columns.left].sort(
    (a, b) => a.baseline - b.baseline || a.x - b.x,
  );
  return [...head, ...columns.right];
}

/** Where an element sits on the page: a line by its baseline, an image by its middle. */
function elementKey(element: Element): number {
  return element.kind === "line"
    ? element.line.baseline
    : element.image.rect.y + element.image.rect.h / 2;
}

function elementX(element: Element): number {
  return element.kind === "line" ? element.line.x : element.image.rect.x;
}

function compareElements(a: Element, b: Element): number {
  return elementKey(a) - elementKey(b) || elementX(a) - elementX(b);
}

/** The text and the images of one page, in reading order. */
function pageElements(page: PageData): Element[] {
  const { gutter, spanning, left, right } = page.columns;
  const head: Element[] = [...spanning, ...left]
    .sort((a, b) => a.baseline - b.baseline || a.x - b.x)
    .map((line) => ({ kind: "line" as const, line }));
  const tail: Element[] = right.map((line) => ({ kind: "line" as const, line }));
  for (const image of page.images) {
    const element: Element = { kind: "image", image };
    // An image that starts in the right column belongs to that column.
    if (gutter && image.rect.x >= gutter[1]) tail.push(element);
    else head.push(element);
  }
  return [...head.sort(compareElements), ...tail.sort(compareElements)];
}

/**
 * Group the lines of a segment into blocks, with the figures placed between them.
 *
 * A figure is placed after the paragraph it interrupts, counted in the lines
 * that precede it.
 */
function buildSegment(
  lines: TextLine[],
  figures: { position: number; image: PlacedImage }[],
  bodySize: number,
): PageItem[] {
  const groups = mergeLinesIntoParagraphs(lines, bodySize);
  const items: PageItem[] = [];
  const pending = [...figures];
  let consumed = 0;
  for (const group of groups) {
    while (pending.length > 0 && pending[0].position <= consumed) {
      items.push({ kind: "figure", image: pending.shift()!.image });
    }
    // A page number is a mark of the page: it is never a heading and never text.
    const pageNumber = isPageNumberText(group[0].text);
    const level = pageNumber ? null : headingLevelForLine(group[0], bodySize);
    if (level !== null) {
      items.push({ kind: "heading", line: group[0], level });
      if (group.length > 1) items.push({ kind: "paragraph", lines: group.slice(1) });
    } else if (pageNumber) {
      items.push({ kind: "meta", line: group[0] });
      if (group.length > 1) items.push({ kind: "paragraph", lines: group.slice(1) });
    } else {
      items.push({ kind: "paragraph", lines: group });
    }
    consumed += group.length;
  }
  while (pending.length > 0) items.push({ kind: "figure", image: pending.shift()!.image });
  return items;
}

/**
 * Move the caption of a figure into the figure.
 *
 * The caption is the standalone line right below the figure; it is taken out of
 * the text flow, so it is no longer a block of its own.
 */
function attachCaptions(items: PageItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "figure") continue;
    const next = items[i + 1];
    if (!next || next.kind !== "paragraph" || next.lines.length !== 1) continue;
    const line = next.lines[0];
    const bottom = item.image.rect.y + item.image.rect.h;
    const top = line.baseline - line.size;
    if (top < bottom || top > bottom + CAPTION_GAP) continue;
    const left = item.image.rect.x;
    const right = left + item.image.rect.w;
    if (line.x + line.width < left || line.x > right) continue;
    item.caption = line.text.trim();
    items.splice(i + 1, 1);
  }
}

function kindForSection(section: Section): BlockKind {
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
}

/** The block a page item becomes. */
function toBlock(item: PageItem, page: number, context: BuildContext): StructuredBlock {
  if (item.kind === "figure") {
    return {
      id: 0,
      kind: "figure",
      text: "",
      page,
      level: 0,
      image: item.image.dataUrl,
      caption: item.caption,
    };
  }
  if (item.kind === "heading") {
    const first = !context.headingSeen;
    context.headingSeen = true;
    // The title is the first heading of the document, and it has to look like one.
    const isTitle =
      first && item.level === 1 && item.line.size >= context.bodySize * TITLE_FACTOR && page === 1;
    if (!isTitle) {
      const matched = sectionForHeading(item.line.text);
      if (matched) context.section = matched;
      else if (context.section === "front" || context.section === "abstract") {
        context.section = "body";
      }
    }
    return {
      id: 0,
      kind: isTitle ? "title" : "heading",
      text: item.line.text.trim(),
      page,
      level: isTitle ? 0 : item.level,
    };
  }
  if (item.kind === "meta") {
    return { id: 0, kind: "meta", text: item.line.text.trim(), page, level: 0 };
  }
  const text = item.lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(" ");
  return { id: 0, kind: kindForSection(context.section), text, page, level: 0 };
}

/** The page a global line index belongs to. */
function pageOfIndex(offsets: number[], index: number): number {
  let page = 0;
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > index) break;
    page = i;
  }
  return page + 1;
}

/**
 * Reflow a PDF into one continuous reading structure.
 *
 * Every page is read once: the text items become lines, the lines are put into
 * reading order (the left column first, then the right one) and the embedded
 * bitmaps are placed in between. The blocks are built afterwards, because the
 * running head of a page can only be told from body text once every page has
 * been seen.
 */
export async function extractPdfStructureReflowed(
  doc: PDFDocumentProxy,
  options: { onProgress?: (done: number, total: number) => void } = {},
): Promise<DocumentStructure> {
  const total = doc.numPages;
  const pages: PageData[] = [];
  let skipped = 0;

  for (let number = 1; number <= total; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = itemsFromTextContent(
      content.items.filter((item): item is PdfJsTextItem => "str" in item),
      viewport.height,
    );
    let images: PlacedImage[] = [];
    try {
      const extracted = await extractPageImages(page);
      images = extracted.images;
      skipped += extracted.skipped;
    } catch (err) {
      console.warn(`第 ${number} 页图片提取失败`, err);
    }
    pages.push({
      pageNumber: number,
      height: viewport.height,
      columns: orderPageColumns(items, viewport.width, viewport.height),
      images,
    });
    options.onProgress?.(number, total);
  }

  const pageLines: PageLines[] = pages.map((page) => ({
    pageNumber: page.pageNumber,
    height: page.height,
    lines: orderedLines(page.columns),
  }));
  const bodySize = bodySizeOf(pageLines.flatMap((page) => page.lines));
  const repeated = repeatedBandTexts(pageLines, total);

  // The lines that survive the running head, per page and as one list.
  const keptByPage: TextLine[][] = [];
  const offsets: number[] = [];
  const allKept: TextLine[] = [];
  let removedLines = 0;
  for (const page of pageLines) {
    const kept = page.lines.filter((line) => !isRunningNumber(line, page.height, repeated));
    removedLines += page.lines.length - kept.length;
    offsets.push(allKept.length);
    keptByPage.push(kept);
    allKept.push(...kept);
  }

  // The reference section is a part of the document, not of a page, so it is
  // found over all lines at once and its entries may run across a page break.
  const referenceRange = findReferenceSection(allKept, bodySize);
  const referenceBlocks: StructuredBlock[] = [];
  if (referenceRange) {
    const entries = sortReferenceEntries(
      splitReferenceEntries(allKept.slice(referenceRange.start + 1, referenceRange.end), bodySize),
    );
    const page = pageOfIndex(offsets, referenceRange.start);
    for (const entry of entries) {
      referenceBlocks.push({
        id: 0,
        kind: "reference",
        text: referenceText(entry.label, entry.text),
        page,
        level: 0,
      });
    }
  }

  const blocks: StructuredBlock[] = [];
  const context: BuildContext = { bodySize, section: "front", headingSeen: false };
  let referenceEmitted = false;

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const keptLines = keptByPage[index];
    const elements = pageElements(page);

    // Where the figures sit, counted in the lines that precede them. The
    // dropped lines are left out, so the count matches the kept lines.
    const keptElements = elements.filter(
      (element) =>
        element.kind === "image" || !isRunningNumber(element.line, page.height, repeated),
    );
    const figures: { position: number; image: PlacedImage }[] = [];
    let seen = 0;
    for (const element of keptElements) {
      if (element.kind === "image") figures.push({ position: seen, image: element.image });
      else seen++;
    }

    // The lines before, inside and after the reference section.
    const pageStart = offsets[index];
    const prefixLines: TextLine[] = [];
    const middleLines: TextLine[] = [];
    const suffixLines: TextLine[] = [];
    keptLines.forEach((line, position) => {
      const global = pageStart + position;
      if (!referenceRange) prefixLines.push(line);
      else if (global > referenceRange.start && global < referenceRange.end) middleLines.push(line);
      else if (global >= referenceRange.end) suffixLines.push(line);
      else prefixLines.push(line);
    });

    const suffixStart = prefixLines.length + middleLines.length;
    const prefixFigures = figures.filter((figure) => figure.position <= prefixLines.length);
    const suffixFigures = figures
      .filter((figure) => figure.position > prefixLines.length)
      .map((figure) => ({ ...figure, position: Math.max(0, figure.position - suffixStart) }));

    const prefixItems = buildSegment(prefixLines, prefixFigures, bodySize);
    const suffixItems = buildSegment(suffixLines, suffixFigures, bodySize);
    attachCaptions(prefixItems);
    attachCaptions(suffixItems);

    for (const item of prefixItems) blocks.push(toBlock(item, page.pageNumber, context));
    if (middleLines.length > 0 && !referenceEmitted) {
      blocks.push(...referenceBlocks);
      referenceEmitted = true;
    }
    for (const item of suffixItems) blocks.push(toBlock(item, page.pageNumber, context));
  }

  const merged = mergeAcrossPages(blocks);
  merged.forEach((block, index) => {
    block.id = index + 1;
  });

  const notices: string[] = [];
  if (skipped > 0) {
    notices.push(`本文档有 ${skipped} 处矢量图形或表格未保留（需要版面模型支持）`);
  }
  if (!merged.some((block) => block.kind !== "figure")) {
    notices.push("未检测到文字，可能是扫描版 PDF");
  }
  return {
    blocks: merged,
    removedLines,
    notice: notices.length > 0 ? notices.join("\n") : undefined,
  };
}
