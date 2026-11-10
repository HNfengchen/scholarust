import { useEffect, useState } from "react";
import type { PanelContext } from "./registry";
import { collectBlocks, clearHighlights, flashElement, highlightMatches } from "./readerDom";

interface SearchItem {
  index: number;
  text: string;
  page: number | null;
  element: HTMLElement | null;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function makeSnippet(text: string, query: string): string {
  const pos = text.toLowerCase().indexOf(query);
  if (pos < 0) return text.slice(0, 80);
  const start = Math.max(0, pos - 40);
  const end = Math.min(text.length, pos + query.length + 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export default function SearchPanel({
  document,
  content,
  extractorRef,
  readerHostRef,
  onShowOriginal,
}: PanelContext) {
  const [items, setItems] = useState<SearchItem[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!document || !content) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      if (content.kind === "pdf") {
        let extract = extractorRef.current;
        let tries = 0;
        while (!extract && tries++ < 20 && !cancelled) {
          await sleep(300);
          extract = extractorRef.current;
        }
        if (cancelled || !extract) return;
        try {
          const paragraphs = await extract();
          if (cancelled) return;
          setItems(
            paragraphs.map((paragraph, index) => ({
              index,
              text: paragraph.text,
              page: paragraph.page,
              element: null,
            })),
          );
        } catch {
          /* ignore */
        }
      } else {
        let found = collectBlocks(readerHostRef.current);
        let tries = 0;
        while (found.length === 0 && tries++ < 12 && !cancelled) {
          await sleep(400);
          found = collectBlocks(readerHostRef.current);
        }
        if (cancelled) return;
        setItems(
          found.map((block, index) => ({
            index,
            text: block.text,
            page: null,
            element: block.element,
          })),
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [document, content, extractorRef, readerHostRef]);

  const needle = query.trim().toLowerCase();
  const results = needle ? items.filter((item) => item.text.toLowerCase().includes(needle)) : [];

  const locate = (item: SearchItem) => {
    onShowOriginal();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const host = readerHostRef.current;
        clearHighlights(host);
        let container: HTMLElement | null;
        let scrollTarget: HTMLElement | null;
        if (item.page != null) {
          const page =
            host?.querySelector<HTMLElement>(`.pdf-page[data-page-number="${item.page}"]`) ?? null;
          container = page?.querySelector<HTMLElement>(".textLayer") ?? page;
          scrollTarget = page;
        } else {
          container = item.element;
          scrollTarget = item.element;
        }
        if (!container) return;
        const firstHit = highlightMatches(container, needle);
        flashElement(container);
        (firstHit ?? scrollTarget ?? container).scrollIntoView({ behavior: "smooth", block: "center" });
      }),
    );
  };

  return (
    <div className="panel-body">
      <div className="search-input-wrap">
        <input
          type="text"
          className="search-input"
          placeholder="在正文中搜索…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={!document}
        />
      </div>
      {!document && <div className="empty-hint">未打开文档</div>}
      {document && needle && results.length === 0 && (
        <div className="empty-hint">未找到匹配「{query.trim()}」的段落</div>
      )}
      {document && needle && (
        <div className="search-count">找到 {results.length} 处</div>
      )}
      {results.map((item) => (
        <div key={item.index} className="search-result" onClick={() => locate(item)}>
          <span className="search-index">¶{item.index + 1}</span>
          <span className="search-snippet">{makeSnippet(item.text, needle)}</span>
        </div>
      ))}
    </div>
  );
}
