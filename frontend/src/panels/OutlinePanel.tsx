import { useEffect, useState } from "react";
import type { PanelContext } from "./registry";
import { collectHeadings, scrollToBlock, scrollToElement, scrollToPage } from "./readerDom";
import { outlineEntriesFromHeadings, outlineEntriesFromStructure } from "../outline";
import type { OutlineEntry } from "../outline";

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function OutlinePanel({
  document,
  content,
  mode,
  structure,
  structureRef,
  outlineRef,
  readerHostRef,
  readingHostRef,
  onShowOriginal,
  onJumpToBlock,
}: PanelContext) {
  const isPdf = content?.kind === "pdf";
  const isReading = mode === "reading";
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEntries([]);
    if (!document) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    // Reading mode renders the shared document structure, so its outline comes
    // straight from it — every format gets block-anchored entries that stay in
    // reading mode when clicked.
    if (isReading) {
      if (structure) {
        setEntries(outlineEntriesFromStructure(structure));
        setLoading(false);
      } else {
        setLoading(true);
      }
      return;
    }

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

    const fromDom = async (): Promise<OutlineEntry[]> => {
      for (let attempt = 0; attempt <= 12 && !cancelled; attempt += 1) {
        const headings = collectHeadings(readerHostRef.current);
        if (headings.length > 0) return outlineEntriesFromHeadings(headings);
        await sleep(400);
      }
      return [];
    };

    const fromStructure = async (): Promise<OutlineEntry[]> => {
      if (structure) return outlineEntriesFromStructure(structure);
      let extract = structureRef.current;
      let tries = 0;
      while (!extract && tries++ < 20 && !cancelled) {
        await sleep(300);
        extract = structureRef.current;
      }
      if (!extract) return [];
      try {
        return outlineEntriesFromStructure(await extract());
      } catch {
        return [];
      }
    };

    const run = async () => {
      let found = await fromReader();
      // PDF readers expose no DOM headings; polling them would only add delay.
      if (!cancelled && found.length === 0 && !isPdf) found = await fromDom();
      if (!cancelled && found.length === 0) found = await fromStructure();
      if (cancelled) return;
      setEntries(found);
      setLoading(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [document, content, isPdf, isReading, structure, structureRef, outlineRef, readerHostRef]);

  const handleClick = (entry: OutlineEntry) => {
    if (isReading) {
      if (entry.blockId != null) scrollToBlock(readingHostRef.current, entry.blockId);
      return;
    }
    if (entry.action) {
      onShowOriginal();
      entry.action();
      return;
    }
    if (entry.page != null) {
      onShowOriginal();
      const page = entry.page;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollToPage(readerHostRef.current, page)),
      );
      return;
    }
    if (entry.element) {
      onShowOriginal();
      const element = entry.element;
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToElement(element)));
      return;
    }
    // Structure-only entry: jump into reading mode at the matching block.
    if (entry.blockId != null) onJumpToBlock(entry.blockId);
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
            title={
              entry.page != null && !isReading ? `跳转到第 ${entry.page} 页` : undefined
            }
          >
            <span className="outline-text">{entry.text}</span>
            {entry.page != null && <span className="outline-page-num">P{entry.page}</span>}
          </div>
        ))}
    </div>
  );
}