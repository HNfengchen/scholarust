import { useEffect, useState } from "react";
import type { PanelContext } from "./registry";
import { collectHeadings, scrollToElement, scrollToPage } from "./readerDom";
import { outlineEntriesFromHeadings } from "../outline";
import type { OutlineEntry } from "../outline";

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
    setEntries([]);
    if (!document) return;
    let cancelled = false;
    setLoading(true);

    const fromReader = async (): Promise<OutlineEntry[]> => {
      let load = outlineRef.current;
      let tries = 0;
      while (!load && tries++ < 20 && !cancelled) {
        await sleep(300);
        load = outlineRef.current;
      }
      if (!load) return [];
      try {
        return await load();
      } catch {
        return [];
      }
    };

    const fromPdfStructure = async (): Promise<OutlineEntry[]> => {
      let extract = structureRef.current;
      let tries = 0;
      while (!extract && tries++ < 20 && !cancelled) {
        await sleep(300);
        extract = structureRef.current;
      }
      if (!extract) return [];
      try {
        const structure = await extract();
        return structure.blocks
          .filter((block) => block.kind === "heading" || block.kind === "title")
          .map((block, index) => ({
            id: `block-${block.id}-${index}`,
            text: block.text,
            level: block.kind === "title" ? 1 : Math.min(block.level || 2, 6),
            page: block.page ?? undefined,
          }));
      } catch {
        return [];
      }
    };

    const fromDom = async (): Promise<OutlineEntry[]> => {
      for (let attempt = 0; attempt <= 12 && !cancelled; attempt += 1) {
        const headings = collectHeadings(readerHostRef.current);
        if (headings.length > 0) return outlineEntriesFromHeadings(headings);
        await sleep(400);
      }
      return [];
    };

    const run = async () => {
      let found = await fromReader();
      if (!cancelled && found.length === 0) {
        found = isPdf ? await fromPdfStructure() : await fromDom();
      }
      if (cancelled) return;
      setEntries(found);
      setLoading(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [document, content, isPdf, structureRef, outlineRef, readerHostRef]);

  const handleClick = (entry: OutlineEntry) => {
    onShowOriginal();
    if (entry.action) {
      entry.action();
      return;
    }
    if (entry.page != null) {
      const page = entry.page;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollToPage(readerHostRef.current, page)),
      );
      return;
    }
    if (entry.element) {
      const element = entry.element;
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToElement(element)));
    }
  };

  return (
    <div className="panel-body">
      {!document && <div className="empty-hint">未打开文档</div>}
      {document && loading && (
        <div className="empty-hint">
          <span className="spinner" /> 正在解析标题大纲…
        </div>
      )}
      {document && !loading && entries.length === 0 && (
        <div className="empty-hint">
          {isPdf ? "未检测到标题，可能为扫描版 PDF" : "未检测到标题"}
        </div>
      )}
      {document &&
        !loading &&
        entries.map((entry) => (
          <div
            key={entry.id}
            className={`outline-item outline-h${Math.min(entry.level || 1, 6)}`}
            onClick={() => handleClick(entry)}
            title={entry.page != null ? `跳转到第 ${entry.page} 页` : undefined}
          >
            <span className="outline-text">{entry.text}</span>
            {entry.page != null && <span className="outline-page-num">P{entry.page}</span>}
          </div>
        ))}
    </div>
  );
}
