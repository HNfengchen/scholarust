import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { RefProxy } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extractPdfParagraphs } from "../paragraphs";
import { extractPdfStructure } from "../structure";
import type { DocumentStructure, ReadingStructureExtractor, StructureExtractor } from "../structure";
import type { ParagraphExtractor } from "../types";
import * as api from "../api";
import { convertFileSrc } from "../api";
import { extractPdfStructureWithLayout } from "../layout/pdfLayout";
import { flattenPdfOutline } from "../outline";
import type { OutlineEntry, OutlineExtractor, PdfOutlineNode } from "../outline";

GlobalWorkerOptions.workerSrc = workerUrl;

async function resolvePdfOutline(
  doc: PDFDocumentProxy,
  nodes: PdfOutlineNode[],
): Promise<PdfOutlineNode[]> {
  const out: PdfOutlineNode[] = [];
  for (const node of nodes) {
    let page: number | undefined;
    try {
      const dest = typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
      if (Array.isArray(dest) && dest[0]) {
        page = (await doc.getPageIndex(dest[0] as RefProxy)) + 1;
      }
    } catch {
      /* broken destination: keep the title, no page */
    }
    out.push({ ...node, page, items: await resolvePdfOutline(doc, node.items ?? []) });
  }
  return out;
}

interface Props {
  url: string;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  outlineRef: MutableRefObject<OutlineExtractor | null>;
  onError: (message: string) => void;
}

export default function PdfReader({ url, extractorRef, structureRef, readingStructureRef, outlineRef, onError }: Props) {
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
      let readingPromise: Promise<DocumentStructure> | null = null;
      readingStructureRef.current = (onProgress) => {
        readingPromise ??= (async () => {
          try {
            const info = await api.layoutModelInfo();
            if (!info.exists) {
              return {
                ...(await extractPdfStructure(doc)),
                notice: `未找到版面模型，已使用简化抽取：${info.path}`,
              };
            }
            return await extractPdfStructureWithLayout(doc, {
              modelUrl: convertFileSrc(info.path),
              onProgress,
            });
          } catch (err) {
            console.warn("layout extraction failed", err);
            return {
              ...(await extractPdfStructure(doc)),
              notice: "版面模型运行失败，已使用简化抽取",
            };
          }
        })();
        return readingPromise;
      };
      let outlinePromise: Promise<OutlineEntry[]> | null = null;
      outlineRef.current = () => {
        outlinePromise ??= (async () => {
          const nodes = (await doc.getOutline()) as PdfOutlineNode[] | null;
          if (!nodes?.length) return [];
          return flattenPdfOutline(await resolvePdfOutline(doc, nodes));
        })();
        return outlinePromise;
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