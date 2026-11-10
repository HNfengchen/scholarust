import type { PDFDocumentProxy } from "pdfjs-dist";
import { sectionForHeading } from "../structure";
import type { DocumentStructure, Section, StructuredBlock } from "../structure";
import { assignTextItems, pickCaption } from "./geometry";
import { loadLayoutSession, runLayoutOnCanvas } from "./model";
import { orderBoxes } from "./order";
import { groupParagraphs, headingLevelForLine, itemsToLines } from "./text";
import type { TextLine } from "./text";
import type { LayoutBox, TextItem } from "./types";

type NewBlock = Omit<StructuredBlock, "id">;

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  box: LayoutBox;
  blocks: NewBlock[];
  caption: string | null;
}

const CAPTION_CLASSES = new Set([
  "figure_caption",
  "table_caption",
  "formula_caption",
  "table_footnote",
]);

const IMAGE_CLASSES = new Set(["figure", "table", "formula"]);

function weightedBodySize(items: TextItem[], fallback: number): number {
  const counts = new Map<number, number>();
  for (const item of items) {
    if (item.str.length < 20) continue;
    const key = Math.round(item.size / 0.5) * 0.5;
    counts.set(key, (counts.get(key) ?? 0) + item.str.length);
  }
  let best: number | null = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best ?? fallback;
}

function cropToDataUrl(
  source: HTMLCanvasElement,
  box: LayoutBox,
  mime: string,
): string {
  const pad = 8;
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const right = Math.min(source.width, Math.ceil(box.x + box.w + pad));
  const bottom = Math.min(source.height, Math.ceil(box.y + box.h + pad));
  const w = Math.max(1, right - x);
  const h = Math.max(1, bottom - y);
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, Math.round(w * scale));
  crop.height = Math.max(1, Math.round(h * scale));
  const context = crop.getContext("2d");
  if (!context) throw new Error("无法创建 canvas 上下文");
  if (mime === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, crop.width, crop.height);
  }
  context.drawImage(source, x, y, w, h, 0, 0, crop.width, crop.height);
  const url = crop.toDataURL(mime, 0.92);
  crop.width = 0;
  crop.height = 0;
  return url;
}

function paragraphLineCounts(lines: TextLine[], tops: number[]): number[] {
  return tops.map((top, index) => {
    const next = index + 1 < tops.length ? tops[index + 1] : Infinity;
    return lines.filter((line) => line.top >= top && line.top < next).length;
  });
}

export async function extractPdfStructureWithLayout(
  doc: PDFDocumentProxy,
  options: { onProgress?: (done: number, total: number) => void },
): Promise<DocumentStructure> {
  const session = await loadLayoutSession();
  const collected: NewBlock[] = [];
  let removedLines = 0;
  let section: Section = "front";
  let titleEmitted = false;

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    let scale = Math.max(2, 1024 / base.width);
    scale = Math.min(scale, 3200 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建 canvas 上下文");
    await page.render({ canvasContext: context, viewport }).promise;

    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const rawSize = Math.abs(item.transform[3]) || item.height || 10;
      items.push({
        x: item.transform[4] * scale,
        top: (base.height - item.transform[5] - rawSize) * scale,
        width: (Math.abs(item.width) || item.str.length * rawSize * 0.5) * scale,
        size: rawSize * scale,
        str: item.str,
      });
    }

    const { detections } = await runLayoutOnCanvas(session, canvas);
    const { assigned, unassigned, removed } = assignTextItems(items, detections);
    removedLines += removed;
    const bodySize = weightedBodySize(items, 10 * scale);

    const regions: Region[] = [];
    for (let i = 0; i < detections.length; i++) {
      const box = detections[i];
      if (box.cls === "abandon") continue;
      const region: Region = {
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        box,
        blocks: [],
        caption: null,
      };
      if (IMAGE_CLASSES.has(box.cls)) {
        const mime = box.cls === "figure" ? "image/jpeg" : "image/png";
        region.blocks.push({
          kind: "figure",
          text: "",
          page: pageNumber,
          level: 0,
          image: cropToDataUrl(canvas, box, mime),
        });
        regions.push(region);
        continue;
      }
      const lines = itemsToLines(assigned[i]);
      if (lines.length === 0) continue;
      const paragraphs = groupParagraphs(lines, box.x, bodySize);
      if (CAPTION_CLASSES.has(box.cls)) {
        region.caption = paragraphs.map((p) => p.text).join(" ");
        regions.push(region);
        continue;
      }
      if (box.cls === "title") {
        paragraphs.forEach((paragraph, index) => {
          if (pageNumber === 1 && !titleEmitted && index === 0) {
            titleEmitted = true;
            region.blocks.push({ kind: "title", text: paragraph.text, page: pageNumber, level: 0 });
          } else if (pageNumber === 1 && titleEmitted && region.blocks.some((b) => b.kind === "title")) {
            region.blocks.push({ kind: "meta", text: paragraph.text, page: pageNumber, level: 0 });
          } else {
            region.blocks.push({ kind: "heading", text: paragraph.text, page: pageNumber, level: 1 });
          }
        });
        regions.push(region);
        continue;
      }
      const counts = paragraphLineCounts(lines, paragraphs.map((p) => p.top));
      paragraphs.forEach((paragraph, index) => {
        const line: TextLine = {
          x: paragraph.x,
          top: paragraph.top,
          size: paragraph.size,
          text: paragraph.text,
        };
        const level = counts[index] === 1 ? headingLevelForLine(line, bodySize) : null;
        if (level !== null) {
          region.blocks.push({ kind: "heading", text: paragraph.text, page: pageNumber, level });
          const matched = sectionForHeading(paragraph.text);
          if (matched) section = matched;
          return;
        }
        const kind =
          section === "abstract"
            ? "abstract"
            : section === "references"
              ? "references"
              : section === "notes"
                ? "note"
                : "paragraph";
        region.blocks.push({ kind, text: paragraph.text, page: pageNumber, level: 0 });
      });
      regions.push(region);
    }

    const ordered = orderBoxes(regions, canvas.width, canvas.height);
    const imageRegions = ordered.filter((region) =>
      IMAGE_CLASSES.has(region.box.cls),
    );
    const captionRegions = ordered.filter((region) => region.caption !== null);
    const usedCaptions = new Set<Region>();
    for (const imageRegion of imageRegions) {
      const available = captionRegions.filter((region) => !usedCaptions.has(region));
      const index = pickCaption(
        imageRegion.box,
        available.map((region) => region.box),
      );
      if (index !== null) {
        const captionRegion = available[index];
        usedCaptions.add(captionRegion);
        for (const block of imageRegion.blocks) block.caption = captionRegion.caption ?? undefined;
      }
    }
    for (const region of ordered) {
      if (region.caption !== null) {
        if (!usedCaptions.has(region)) {
          collected.push({ kind: "caption", text: region.caption, page: pageNumber, level: 0 });
        }
        continue;
      }
      collected.push(...region.blocks);
    }

    if (unassigned.length > 0) {
      const lines = itemsToLines(unassigned);
      const paragraphs = groupParagraphs(lines, 0, bodySize);
      const counts = paragraphLineCounts(lines, paragraphs.map((p) => p.top));
      paragraphs.forEach((paragraph, index) => {
        const level =
          counts[index] === 1
            ? headingLevelForLine(
                { x: paragraph.x, top: paragraph.top, size: paragraph.size, text: paragraph.text },
                bodySize,
              )
            : null;
        collected.push({
          kind: level !== null ? "heading" : "paragraph",
          text: paragraph.text,
          page: pageNumber,
          level: level ?? 0,
        });
      });
    }

    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    options.onProgress?.(pageNumber, doc.numPages);
  }

  const merged: NewBlock[] = [];
  for (const block of collected) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.kind === "paragraph" &&
      block.kind === "paragraph" &&
      !/[.!?。！？]$/.test(previous.text) &&
      /^[a-z\u4e00-\u9fff]/.test(block.text)
    ) {
      previous.text += ` ${block.text}`;
      continue;
    }
    merged.push({ ...block });
  }

  const blocks: StructuredBlock[] = merged.map((block, index) => ({ ...block, id: index + 1 }));
  if (blocks.length === 0) {
    return {
      blocks,
      removedLines,
      notice: "未检测到可阅读的文字（可能是扫描版 PDF）",
    };
  }
  return { blocks, removedLines };
}