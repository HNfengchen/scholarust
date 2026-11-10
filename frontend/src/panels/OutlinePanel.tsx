import { useEffect, useState } from "react";
import type { PanelContext } from "./registry";
import { collectHeadings, scrollToElement, scrollToPage } from "./readerDom";
import type { HeadingItem } from "./readerDom";
import type { StructuredBlock } from "../structure";

export default function OutlinePanel({
  document,
  content,
  structureRef,
  readerHostRef,
  onShowOriginal,
}: PanelContext) {
  const isPdf = content?.kind === "pdf";
  const [pdfHeadings, setPdfHeadings] = useState<StructuredBlock[]>([]);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!document || !isPdf) {
      setPdfHeadings([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      let extract = structureRef.current;
      let tries = 0;
      while (!extract && tries++ < 20 && !cancelled) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        extract = structureRef.current;
      }
      if (cancelled || !extract) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const structure = await extract();
        if (cancelled) return;
        setPdfHeadings(
          structure.blocks.filter((block) => block.kind === "heading" || block.kind === "title"),
        );
      } catch {
        /* ignore extraction errors */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [document, isPdf, structureRef]);

  useEffect(() => {
    if (!document || isPdf || !content) {
      setHeadings([]);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const poll = () => {
      if (cancelled) return;
      const found = collectHeadings(readerHostRef.current);
      setHeadings(found);
      if (found.length === 0 && attempts++ < 12) {
        window.setTimeout(poll, 400);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [document, isPdf, content, readerHostRef]);

  return (
    <div className="panel-body">
      {!document && <div className="empty-hint">未打开文档</div>}
      {document && isPdf && loading && (
        <div className="empty-hint">
          <span className="spinner" /> 正在解析标题大纲…
        </div>
      )}
      {document && isPdf && !loading && pdfHeadings.length === 0 && (
        <div className="empty-hint">未检测到标题，可能为扫描版 PDF</div>
      )}
      {document &&
        isPdf &&
        pdfHeadings.map((block) => (
          <div
            key={block.id}
            className={`outline-item outline-h${block.kind === "title" ? 1 : Math.min(block.level || 2, 6)}`}
            onClick={() => {
              if (block.page == null) return;
              onShowOriginal();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => scrollToPage(readerHostRef.current, block.page!)),
              );
            }}
            title={block.page != null ? `跳转到第 ${block.page} 页` : undefined}
          >
            <span className="outline-text">{block.text}</span>
            {block.page != null && <span className="outline-page-num">P{block.page}</span>}
          </div>
        ))}
      {document && !isPdf && headings.length === 0 && <div className="empty-hint">未检测到标题</div>}
      {document &&
        !isPdf &&
        headings.map((heading, index) => (
          <div
            key={index}
            className={`outline-item outline-h${heading.level}`}
            onClick={() => {
              onShowOriginal();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => scrollToElement(heading.element)),
              );
            }}
          >
            <span className="outline-text">{heading.text}</span>
          </div>
        ))}
    </div>
  );
}