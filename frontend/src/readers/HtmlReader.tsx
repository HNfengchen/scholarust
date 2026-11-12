import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import mammoth from "mammoth";
import { extractHtmlParagraphs } from "../paragraphs";
import { extractHtmlStructure, extractTextStructure } from "../structure";
import { sanitizeContentHtml, throwIfContentAborted } from "../contentHtml";
import type { ReadingStructureExtractor, StructureExtractor } from "../structure";
import type { DocumentKind, ParagraphExtractor } from "../types";
import { outlineEntriesFromHeadings } from "../outline";
import type { OutlineExtractor } from "../outline";
import { collectHeadings } from "../panels/readerDom";
import type { HeadingItem } from "../panels/readerDom";

interface Props {
  kind: DocumentKind;
  html: string | null;
  raw: string | null;
  docxUrl: string | null;
  docId: string;
  zoom: number;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  outlineRef: MutableRefObject<OutlineExtractor | null>;
  onError: (message: string) => void;
}

const MD_HEADING = /^(#{1,6})\s+(.*)$/;

// mammoth's default style map only knows English heading styles, so paragraphs
// styled with the Chinese WPS/Word names ("标题 1"…) fall back to <p> and the
// outline finds nothing. These rules are merged with the defaults, which keep
// covering English "Heading 1"… styles.
const DOCX_HEADING_STYLE_MAP = Array.from({ length: 6 }, (_, index) => {
  const level = index + 1;
  return [
    `p[style-name='标题 ${level}'] => h${level}:fresh`,
    `p[style-name='标题${level}'] => h${level}:fresh`,
  ];
}).flat();

/** Show the Markdown source verbatim, line by line, keeping heading lines referenceable for the outline. */
function renderMarkdownSource(container: HTMLElement, raw: string): HeadingItem[] {
  const pre = document.createElement("pre");
  pre.className = "raw-markdown";
  const headings: HeadingItem[] = [];
  const lines = raw.split("\n");
  for (const [index, line] of lines.entries()) {
    const span = document.createElement("span");
    span.className = "raw-line";
    span.textContent = line + (index < lines.length - 1 ? "\n" : "");
    pre.appendChild(span);
    // A CRLF file leaves a trailing \r that the heading regex's `$` cannot
    // match; strip it for detection only, keeping the displayed source verbatim.
    const match = MD_HEADING.exec(line.replace(/\r$/, ""));
    if (match) headings.push({ text: match[2].trim(), level: match[1].length, element: span });
  }
  container.appendChild(pre);
  return headings;
}

export default function HtmlReader({ kind, html, raw, docxUrl, docId, zoom, extractorRef, structureRef, readingStructureRef, outlineRef, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const controller = new AbortController();
    container.replaceChildren();

    const registerFromDom = (root: ParentNode, host: HTMLElement) => {
      extractorRef.current = async () => extractHtmlParagraphs(root);
      structureRef.current = () => extractHtmlStructure(root, { docId });
      readingStructureRef.current = (_onProgress, signal) => extractHtmlStructure(root, { docId, signal });
      outlineRef.current = async () => outlineEntriesFromHeadings(collectHeadings(host));
    };

    if (docxUrl) {
      setLoading(true);
      const run = async () => {
        const response = await fetch(docxUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: DOCX_HEADING_STYLE_MAP });
        if (cancelled) return;
        const source = new DOMParser().parseFromString(result.value, "text/html");
        const { fragment, notice } = await sanitizeContentHtml(source, { docId, signal: controller.signal });
        if (cancelled) return;
        container.replaceChildren(fragment);
        registerFromDom(container, container);
        if (notice) onError(notice);
      };
      run()
        .catch((err) => {
          if (!cancelled) onError(`DOCX 转换失败：${String(err)}`);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (kind === "markdown") {
      // Original mode shows the raw source; reading mode renders the HTML the
      // backend produced, so the two modes share one document but differ in form.
      const headings = renderMarkdownSource(container, raw ?? "");
      const rendered = new DOMParser().parseFromString(html ?? "", "text/html");
      extractorRef.current = async () => extractHtmlParagraphs(rendered);
      structureRef.current = () => extractHtmlStructure(rendered, { docId });
      readingStructureRef.current = (_onProgress, signal) => extractHtmlStructure(rendered, { docId, signal });
      outlineRef.current = async () => outlineEntriesFromHeadings(headings);
    } else {
      // Plain text: original keeps the source lines; reading gives one block per
      // line so every line can be translated on its own.
      const text = raw ?? "";
      const view = document.createElement("div");
      view.className = "raw-text";
      view.textContent = text;
      container.appendChild(view);
      const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
      extractorRef.current = async () => lines.map((line) => ({ text: line, page: null }));
      structureRef.current = async () => extractTextStructure(text);
      readingStructureRef.current = async (_onProgress, signal) => {
        throwIfContentAborted(signal);
        return extractTextStructure(text);
      };
      outlineRef.current = async () => [];
    }

    return () => {
      cancelled = true;
      controller.abort();
      extractorRef.current = null;
      structureRef.current = null;
      readingStructureRef.current = null;
      outlineRef.current = null;
    };
  }, [kind, html, raw, docxUrl, docId, extractorRef, structureRef, readingStructureRef, outlineRef, onError]);

  return (
    <div className="html-reader-wrap">
      {loading && <div className="reader-status">正在转换 DOCX…</div>}
      <div ref={containerRef} className="html-reader" style={{ zoom }} />
    </div>
  );
}