import { useEffect, useState } from "react";
import type { PanelContext } from "./registry";
import { collectHeadings, scrollToElement, scrollToPage } from "./readerDom";
import { outlineEntriesFromHeadings } from "../outline";
import type { OutlineEntry } from "../outline";

export default function OutlinePanel({
  document,
  content,
  structureRef,
  outlineRef,
  readerHostRef,
  onShowOriginal,
}: PanelContext) {
  const isPdf = content?.kind === "pdf";
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!document || !content) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    const run = async () => {
      let extractor = outlineRef.current;
      let tries = 0;
      while (!extractor && tries++ < 20 && !cancelled) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        extractor = outlineRef.current;
      }
      if (cancelled) return;
      let result: OutlineEntry[] = [];
      if (extractor) {
        try {
          result = await extractor();
        } catch {
          /* fall through to fallbacks */
        }
      }
      if (cancelled) return;
      if (result.length === 0 && isPdf) {
        let extract = structureRef.current;
        let structTries = 0;
        while (!extract && structTries++ < 20 && !cancelled) {
          await new Promise((resolve) => window.setTimeout(resolve, 300));
          extract = structureRef.current;
        }
        if (cancelled) return;
        if (extract) {
          try {
            const structure = await extract();
            if (cancelled) return;
            result = structure.blocks
              .filter((block) => block.kind === "heading" || block.kind === "title")
              .map((block) => ({
                id: `struct-${block.id}`,
                text: block.text,
                level: block.kind === "title" ? 1 : Math.min(block.level || 2, 6),
                page: block.page ?? undefined,
              }));
          } catch {
            /* ignore extraction errors */
          }
        }
      }
      if (cancelled) return;
      if (result.length === 0 && !isPdf) {
        let attempts = 0;
        while (result.length === 0 && attempts++ < 12 && !cancelled) {
          result = outlineEntriesFromHeadings(collectHeadings(readerHostRef.current));
          if (result.length === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 400));
          }
        }
      }
      if (cancelled) return;
      setEntries(result);
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [document, content, isPdf, structureRef, outlineRef, readerHostRef]);

  return (
    <div className="panel-body">
      {!document && <div className="empty-hint">未打开文档</div>}
      {document && loading && (
        <div className="empty-hint">
          <span className="spinner" /> 正在读取大纲…
        </div>
      )}
      {document && !loading && entries.length === 0 && (
        <div className="empty-hint">
          {isPdf ? "未检测到标题，可能为扫描版 PDF" : "未检测到标题"}
        </div>
      )}
      {document &&
        entries.map((entry) => (
          <div
            key={entry.id}
            className={`outline-item outline-h${Math.min(entry.level, 6)}`}
            onClick={() => {
              onShowOriginal();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  if (entry.action) void entry.action();
                  else if (entry.page != null) scrollToPage(readerHostRef.current, entry.page);
                  else if (entry.element) scrollToElement(entry.element);
                }),
              );
            }}
            title={entry.page != null ? `跳转到第 ${entry.page} 页` : undefined}
          >
            <span className="outline-text">{entry.text}</span>
            {entry.page != null && <span className="outline-page-num">P{entry.page}</span>}
          </div>
        ))}
    </div>
  );
}