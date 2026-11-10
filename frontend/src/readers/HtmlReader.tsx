import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import mammoth from "mammoth";
import { extractHtmlParagraphs } from "../paragraphs";
import { extractHtmlStructure } from "../structure";
import type { ReadingStructureExtractor, StructureExtractor } from "../structure";
import type { ParagraphExtractor } from "../types";

interface Props {
  html: string | null;
  docxUrl: string | null;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  onError: (message: string) => void;
}

export default function HtmlReader({ html, docxUrl, extractorRef, structureRef, readingStructureRef, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    container.replaceChildren();

    const register = () => {
      extractorRef.current = async () => extractHtmlParagraphs(container);
      structureRef.current = async () => extractHtmlStructure(container);
      readingStructureRef.current = structureRef.current;
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
    };
  }, [html, docxUrl, extractorRef, structureRef, readingStructureRef, onError]);

  return (
    <div className="html-reader-wrap">
      {loading && <div className="reader-status">正在转换 DOCX…</div>}
      <div ref={containerRef} className="html-reader" />
    </div>
  );
}