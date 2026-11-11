export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
  page?: number;
  href?: string;
  element?: HTMLElement;
  action?: () => void | Promise<void>;
}

export type OutlineExtractor = () => Promise<OutlineEntry[]>;

export interface PdfOutlineItem {
  title?: string;
  /** Raw pdf.js destination, or an already-resolved `{type:"page-ref",pageNumber}`. */
  dest?: unknown;
  /** 1-based page, when the caller resolved the destination itself. */
  page?: number;
  items?: PdfOutlineItem[];
}

export type PdfOutlineNode = PdfOutlineItem;

export interface NavItem {
  label?: string;
  href?: string;
  subitems?: NavItem[];
}

export type EpubNavNode = NavItem;

function pageRefPage(dest: unknown): number | undefined {
  if (!dest || typeof dest !== "object") return undefined;
  const ref = dest as { type?: string; pageNumber?: number };
  if (ref.type !== "page-ref" || typeof ref.pageNumber !== "number") return undefined;
  return ref.pageNumber + 1;
}

export function flattenPdfOutline(items: PdfOutlineItem[], level = 1): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const walk = (list: PdfOutlineItem[], depth: number) => {
    for (const item of list) {
      const text = (item.title ?? "").trim();
      if (text) {
        const page = typeof item.page === "number" ? item.page : pageRefPage(item.dest);
        entries.push({ id: `pdf-${entries.length}`, text, level: depth, page });
      }
      if (item.items?.length) walk(item.items, depth + 1);
    }
  };
  walk(items, level);
  return entries;
}

export function flattenEpubNav(items: NavItem[], level = 1): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const walk = (list: NavItem[], depth: number) => {
    for (const item of list) {
      const text = (item.label ?? "").trim();
      if (text) {
        entries.push({ id: `nav-${entries.length}`, text, level: depth, href: item.href });
      }
      if (item.subitems?.length) walk(item.subitems, depth + 1);
    }
  };
  walk(items, level);
  return entries;
}

export function outlineEntriesFromHeadings(
  headings: { text: string; level: number; element: HTMLElement }[],
): OutlineEntry[] {
  return headings.map((heading, index) => ({
    id: `heading-${index}`,
    text: heading.text,
    level: heading.level,
    element: heading.element,
  }));
}
