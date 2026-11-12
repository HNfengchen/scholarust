export interface HeadingItem {
  text: string;
  level: number;
  element: HTMLElement;
}

export interface BlockItem {
  text: string;
  element: HTMLElement;
}

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote";

function iframeDocuments(host: HTMLElement): Document[] {
  const docs: Document[] = [];
  for (const frame of Array.from(host.querySelectorAll("iframe"))) {
    try {
      const doc = frame.contentDocument;
      if (doc) docs.push(doc);
    } catch {
      /* cross-origin iframe, skip */
    }
  }
  return docs;
}

export function collectHeadings(host: HTMLElement | null): HeadingItem[] {
  if (!host) return [];
  const roots: ParentNode[] = [host, ...iframeDocuments(host)];
  const items: HeadingItem[] = [];
  for (const root of roots) {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"))) {
      const text = (element.textContent || "").trim();
      if (text) {
        items.push({ text, level: Number(element.tagName.slice(1)), element });
      }
    }
  }
  return items;
}

export function collectBlocks(host: HTMLElement | null): BlockItem[] {
  if (!host) return [];
  const roots: ParentNode[] = [host, ...iframeDocuments(host)];
  const items: BlockItem[] = [];
  for (const root of roots) {
    const matched = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    const topLevel = matched.filter(
      (element) => !matched.some((other) => other !== element && other.contains(element)),
    );
    for (const element of topLevel) {
      const text = (element.innerText || element.textContent || "").trim();
      if (text) items.push({ text, element });
    }
  }
  return items;
}

// Jumps must not animate. The reading article only estimates off-screen
// blocks (content-visibility: auto), so an animated scroll re-lays out the
// blocks it sweeps past; the target then moves while the animation still
// heads for its old offset, landing short and needing repeated clicks.
function alignToStart(element: HTMLElement): void {
  element.scrollIntoView({ block: "start" });
}

export function scrollToPage(host: HTMLElement | null, page: number): void {
  if (!host) return;
  const target = host.querySelector<HTMLElement>(`.pdf-page[data-page-number="${page}"]`);
  if (target) alignToStart(target);
}

export function scrollToElement(element: HTMLElement): void {
  alignToStart(element);
}

/** Scroll the reading view to a block by its `data-block-id` and flash it. */
export function scrollToBlock(host: HTMLElement | null, blockId: number): void {
  if (!host) return;
  const target = host.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
  if (!target) return;
  // The reading toolbar sticks over the top of the scrollport; reserve its
  // height so the target lands below it rather than hidden behind it.
  const toolbar = host.querySelector<HTMLElement>(".reading-toolbar");
  target.style.scrollMarginTop = `${toolbar?.offsetHeight ?? 0}px`;
  alignToStart(target);
  target.style.scrollMarginTop = "";
  flashElement(target);
}

export function clearHighlights(host: HTMLElement | null): void {
  if (!host) return;
  const roots: ParentNode[] = [host, ...iframeDocuments(host)];
  for (const root of roots) {
    for (const mark of Array.from(root.querySelectorAll("mark.search-hit"))) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
    for (const element of Array.from(root.querySelectorAll<HTMLElement>(".search-flash"))) {
      element.classList.remove("search-flash");
    }
  }
}

// 在容器内的文本节点中把命中查询的片段包成 <mark>，返回首个命中元素。
// 仅操作既有文本节点、不插入 HTML，因此对 iframe 内的原文也是安全的。
export function highlightMatches(container: HTMLElement, query: string): HTMLElement | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const doc = container.ownerDocument;
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }
  let first: HTMLElement | null = null;
  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    const lower = text.toLowerCase();
    let idx = lower.indexOf(needle);
    if (idx < 0) continue;
    const frag = doc.createDocumentFragment();
    let cursor = 0;
    while (idx >= 0) {
      frag.appendChild(doc.createTextNode(text.slice(cursor, idx)));
      const mark = doc.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      first ??= mark;
      cursor = idx + needle.length;
      idx = lower.indexOf(needle, cursor);
    }
    frag.appendChild(doc.createTextNode(text.slice(cursor)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return first;
}

export function flashElement(element: HTMLElement): void {
  element.classList.remove("search-flash");
  void element.offsetWidth;
  element.classList.add("search-flash");
  window.setTimeout(() => element.classList.remove("search-flash"), 1800);
}
