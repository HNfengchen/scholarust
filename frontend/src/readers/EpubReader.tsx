import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { extractEpubParagraphs } from "../paragraphs";
import { extractEpubStructure } from "../structure";
import type { ReadingStructureExtractor, StructureExtractor } from "../structure";
import type { ParagraphExtractor } from "../types";
import { flattenEpubNav } from "../outline";
import type { EpubNavNode, OutlineExtractor } from "../outline";

interface Props {
  url: string;
  docId: string;
  zoom: number;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  outlineRef: MutableRefObject<OutlineExtractor | null>;
  onError: (message: string) => void;
  onSelection: (text: string) => void;
}

export default function EpubReader({ url, docId, zoom, extractorRef, structureRef, readingStructureRef, outlineRef, onError, onSelection }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onSelectionRef = useRef(onSelection);
  const onErrorRef = useRef(onError);
  onSelectionRef.current = onSelection;
  onErrorRef.current = onError;

  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${Math.round(zoom * 100)}%`);
  }, [zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const controller = new AbortController();
    let book: Book | null = null;

    const run = async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (cancelled) return;
      book = ePub(buffer);
      const rendition = book.renderTo(container, { width: "100%", height: "100%" });
      rendition.themes.fontSize(`${Math.round(zoomRef.current * 100)}%`);
      renditionRef.current = rendition;
      const wholeBook = book;
      extractorRef.current = async () => extractEpubParagraphs(rendition);
      structureRef.current = () => extractEpubStructure(wholeBook, { docId });
      readingStructureRef.current = (onProgress, signal) =>
        extractEpubStructure(wholeBook, { docId, onProgress, signal });
      const currentBook = book;
      outlineRef.current = async () => {
        const navigation = await currentBook.loaded.navigation;
        return flattenEpubNav(navigation.toc as unknown as EpubNavNode[]).map((entry) => ({
          ...entry,
          action: entry.href ? () => rendition.display(entry.href!) : undefined,
        }));
      };
      rendition.on("selected", (_cfiRange: string, contents: { window: Window }) => {
        const text = contents.window.getSelection()?.toString().trim() ?? "";
        if (text) onSelectionRef.current(text);
      });
      await rendition.display();
    };

    run().catch((err) => {
      if (!cancelled) onErrorRef.current(`EPUB 渲染失败：${String(err)}`);
    });

    return () => {
      cancelled = true;
      controller.abort();
      renditionRef.current = null;
      extractorRef.current = null;
      structureRef.current = null;
      readingStructureRef.current = null;
      outlineRef.current = null;
      book?.destroy();
      container.replaceChildren();
    };
  }, [url, docId, extractorRef, structureRef, readingStructureRef, outlineRef]);

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