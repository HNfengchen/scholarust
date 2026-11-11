import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extractPdfParagraphs } from "../paragraphs";
import { extractPdfStructure } from "../structure";
import type { ReadingStructureExtractor, StructureExtractor } from "../structure";
import { extractPdfStructureReflowed } from "../layout/pdfStructure";
import { flattenPdfOutline } from "../outline";
import type { OutlineEntry, PdfOutlineItem } from "../outline";
import type { ParagraphExtractor } from "../types";

GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  url: string;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  outlineRef: MutableRefObject<(() => Promise<OutlineEntry[]>) | null>;
  onError: (message: string) => void;
}

type RawOutlineItem = { title: string; dest: unknown; items?: RawOutlineItem[] };

// pdf.js hands out raw destinations; turn them into 0-based page indexes first.
async function resolveOutline(
  doc: PDFDocumentProxy,
  items: RawOutlineItem[],
): Promise<PdfOutlineItem[]> {
  const resolved: PdfOutlineItem[] = [];
  for (const item of items) {
    let dest = item.dest;
    if (typeof dest === "string") {
      dest = await doc.getDestination(dest).catch(() => null);
    }
    let pageNumber: number | undefined;
    if (Array.isArray(dest) && dest.length > 0) {
      const first = dest[0];
      const index =
        typeof first === "number"
          ? first
          : await doc
              .getPageIndex(first as Parameters<PDFDocumentProxy["getPageIndex"]>[0])
              .catch(() => null);
      if (typeof index === "number") pageNumber = index;
    }
    resolved.push({
      title: item.title,
      dest: pageNumber == null ? null : { type: "page-ref", pageNumber },
      items: item.items ? await resolveOutline(doc, item.items) : undefined,
    });
  }
  return resolved;
}

export default function PdfReader({
  url,
  extractorRef,
  structureRef,
  readingStructureRef,
  outlineRef,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("正在加载 PDF…");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    container.replaceChildren();
    setStatus("正在加载 PDF…");

    const run = async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      if (cancelled) return;
      loadingTask = getDocument({ data });
      const doc = await loadingTask.promise;
      if (cancelled) return;
      extractorRef.current = () => extractPdfParagraphs(doc);
      let structurePromise: ReturnType<StructureExtractor> | null = null;
      structureRef.current = () => {
        structurePromise ??= extractPdfStructure(doc);
        return structurePromise;
      };
      // The reading mode reflows the pages instead of guessing the structure.
      readingStructureRef.current = async (onProgress) =>
        extractPdfStructureReflowed(doc, { onProgress });
      outlineRef.current = async () => {
        const outline = (await doc.getOutline()) as RawOutlineItem[] | null;
        if (!outline?.length) return [];
        return flattenPdfOutline(await resolveOutline(doc, outline));
      };
      const available = Math.max(container.clientWidth - 48, 320);
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        if (cancelled) return;
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: available / base.width });
        const dpr = window.devicePixelRatio || 1;
        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page";
        wrapper.dataset.pageNumber = String(pageNumber);
        wrapper.style.setProperty("--scale-factor", String(viewport.scale));
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        wrapper.appendChild(canvas);
        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer";
        wrapper.appendChild(textLayerDiv);
        container.appendChild(wrapper);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建 canvas 上下文");
        await page.render({
          canvasContext: context,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        }).promise;
        if (cancelled) return;
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
        if (!cancelled) setStatus(`已渲染第 ${pageNumber} / ${doc.numPages} 页`);
      }
      if (!cancelled) setStatus("");
    };

    run().catch((err) => {
      if (!cancelled) {
        setStatus("");
        onError(`PDF 渲染失败：${String(err)}`);
      }
    });

    return () => {
      cancelled = true;
      extractorRef.current = null;
      structureRef.current = null;
      readingStructureRef.current = null;
      outlineRef.current = null;
      container.replaceChildren();
      void loadingTask?.destroy();
    };
  }, [url, extractorRef, structureRef, readingStructureRef, outlineRef, onError]);

  return (
    <div className="pdf-reader">
      {status && <div className="reader-status">{status}</div>}
      <div ref={containerRef} className="pdf-pages" />
    </div>
  );
}