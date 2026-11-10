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

export function scrollToPage(host: HTMLElement | null, page: number): void {
  if (!host) return;
  const target = host.querySelector<HTMLElement>(`.pdf-page[data-page-number="${page}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function scrollToElement(element: HTMLElement): void {
  element.scrollIntoView({ behavior: "smooth", block: "start" });
}
