import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import mammoth from "mammoth";
import { extractHtmlParagraphs } from "../paragraphs";
import { extractHtmlStructure } from "../structure";
import type { ReadingStructureExtractor, StructureExtractor } from "../structure";
import { outlineEntriesFromHeadings } from "../outline";
import type { OutlineEntry } from "../outline";
import { collectHeadings } from "../panels/readerDom";
import type { ParagraphExtractor } from "../types";

interface Props {
  html: string | null;
  docxUrl: string | null;
  docId: string;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  outlineRef: MutableRefObject<(() => Promise<OutlineEntry[]>) | null>;
  onError: (message: string) => void;
}

export default function HtmlReader({
  html,
  docxUrl,
  docId,
  extractorRef,
  structureRef,
  readingStructureRef,
  outlineRef,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    container.replaceChildren();

    const register = () => {
      extractorRef.current = async () => extractHtmlParagraphs(container);
      structureRef.current = async () => extractHtmlStructure(container, { docId });
      // The html extractor already returns a promise, so it reads as it is.
      readingStructureRef.current = structureRef.current;
      outlineRef.current = async () =>
        outlineEntriesFromHeadings(collectHeadings(container));
    };

    if (docxUrl) {
      setLoading(true);
      const run = async () => {
        const response = await fetch(docxUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        container.innerHTML = result.value;
        register();
      };
      run()
        .catch((err) => {
          if (!cancelled) onError(`DOCX 转换失败：${String(err)}`);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      container.innerHTML = html ?? "";
      register();
    }

    return () => {
      cancelled = true;
      extractorRef.current = null;
      structureRef.current = null;
      readingStructureRef.current = null;
      outlineRef.current = null;
    };
  }, [html, docxUrl, docId, extractorRef, structureRef, readingStructureRef, outlineRef, onError]);

  return (
    <div className="html-reader-wrap">
      {loading && <div className="reader-status">正在转换 DOCX…</div>}
      <div ref={containerRef} className="html-reader" />
    </div>
  );
}