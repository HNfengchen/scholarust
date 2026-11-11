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
import { extractPdfStructureReflowed } from "../layout/pdfStructure";
import { detectLayout, layoutModelInfo } from "../api";
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
  zoom: number;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  outlineRef: MutableRefObject<OutlineExtractor | null>;
  onError: (message: string) => void;
}

export default function PdfReader({ url, zoom, extractorRef, structureRef, readingStructureRef, outlineRef, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderSeq = useRef(0);
  const lastWidth = useRef(0);
  const [renderKey, setRenderKey] = useState(0);
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
      docRef.current = doc;
      extractorRef.current = () => extractPdfParagraphs(doc);
      let structurePromise: ReturnType<StructureExtractor> | null = null;
      structureRef.current = () => {
        structurePromise ??= extractPdfStructure(doc);
        return structurePromise;
      };
      let readingPromise: Promise<DocumentStructure> | null = null;
      readingStructureRef.current = (onProgress, signal) => {
        if (!readingPromise) {
          const promise = layoutModelInfo().then((model) => extractPdfStructureReflowed(doc, {
            onProgress, signal, detectLayout: model.exists ? detectLayout : undefined,
          }));
          readingPromise = promise;
          promise.catch(() => {
            if (readingPromise === promise) readingPromise = null;
          });
        }
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
      setRenderKey((key) => key + 1);
    };

    run().catch((err) => {
      if (!cancelled) {
        setStatus("");
        onError(`PDF 渲染失败：${String(err)}`);
      }
    });

    return () => {
      cancelled = true;
      docRef.current = null;
      extractorRef.current = null;
      structureRef.current = null;
      readingStructureRef.current = null;
      outlineRef.current = null;
      container.replaceChildren();
      void loadingTask?.destroy();
    };
  }, [url, extractorRef, structureRef, readingStructureRef, outlineRef, onError]);

  useEffect(() => {
    const container = containerRef.current;
    const doc = docRef.current;
    if (!container || !doc || container.clientWidth === 0) return;
    const seq = ++renderSeq.current;
    let cancelled = false;

    const render = async () => {
      const scroller = container.closest<HTMLElement>(".reader-area");
      const scrollRatio =
        scroller && scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0;
      const available = Math.max(container.clientWidth - 48, 320);
      lastWidth.current = container.clientWidth;
      container.replaceChildren();
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        if (cancelled || seq !== renderSeq.current) return;
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (available / base.width) * zoom });
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
        if (cancelled || seq !== renderSeq.current) return;
        const textContent = await page.getTextContent();
        if (cancelled || seq !== renderSeq.current) return;
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
        if (!cancelled && seq === renderSeq.current) {
          setStatus(`已渲染第 ${pageNumber} / ${doc.numPages} 页`);
        }
      }
      if (!cancelled && seq === renderSeq.current) {
        setStatus("");
        if (scroller) scroller.scrollTop = scrollRatio * scroller.scrollHeight;
      }
    };

    render().catch((err) => {
      if (!cancelled && seq === renderSeq.current) {
        setStatus("");
        onError(`PDF 渲染失败：${String(err)}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [renderKey, zoom, onError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (Math.abs(container.clientWidth - lastWidth.current) > 8) {
          setRenderKey((key) => key + 1);
        }
      }, 200);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="pdf-reader">
      {status && <div className="reader-status">{status}</div>}
      <div ref={containerRef} className="pdf-pages" />
    </div>
  );
}