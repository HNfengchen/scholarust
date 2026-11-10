import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { extractEpubParagraphs } from "../paragraphs";
import { extractEpubStructure } from "../structure";
import type { ReadingStructureExtractor, StructureExtractor } from "../structure";
import type { ParagraphExtractor } from "../types";

interface Props {
  url: string;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  onError: (message: string) => void;
  onSelection: (text: string) => void;
}

export default function EpubReader({ url, extractorRef, structureRef, readingStructureRef, onError, onSelection }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let book: Book | null = null;

    const run = async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (cancelled) return;
      book = ePub(buffer);
      const rendition = book.renderTo(container, { width: "100%", height: "100%" });
      renditionRef.current = rendition;
      extractorRef.current = async () => extractEpubParagraphs(rendition);
      structureRef.current = async () => extractEpubStructure(rendition);
      readingStructureRef.current = structureRef.current;
      rendition.on("selected", (_cfiRange: string, contents: { window: Window }) => {
        const text = contents.window.getSelection()?.toString().trim() ?? "";
        if (text) onSelection(text);
      });
      await rendition.display();
    };

    run().catch((err) => {
      if (!cancelled) onError(`EPUB 渲染失败：${String(err)}`);
    });

    return () => {
      cancelled = true;
      renditionRef.current = null;
      extractorRef.current = null;
      structureRef.current = null;
      readingStructureRef.current = null;
      book?.destroy();
      container.replaceChildren();
    };
  }, [url, extractorRef, structureRef, readingStructureRef, onError, onSelection]);

  return (
    <div className="epub-reader">
      <div ref={containerRef} className="epub-container" />
      <div className="epub-nav">
        <button className="btn" onClick={() => void renditionRef.current?.prev()}>
          上一页
        </button>
        <button className="btn" onClick={() => void renditionRef.current?.next()}>
          下一页
        </button>
      </div>
    </div>
  );
}