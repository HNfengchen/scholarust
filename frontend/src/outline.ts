export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
  page?: number;
  href?: string;
  element?: HTMLElement;
  action?: () => void;
}

export interface PdfOutlineItem {
  title?: string;
  dest?: { type?: string; pageNumber?: number } | null;
  items?: PdfOutlineItem[];
}

export interface NavItem {
  label?: string;
  href?: string;
  subitems?: NavItem[];
}

export function flattenPdfOutline(items: PdfOutlineItem[], level = 1): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const walk = (list: PdfOutlineItem[], depth: number) => {
    for (const item of list) {
      const text = (item.title ?? "").trim();
      if (text) {
        const page =
          item.dest?.type === "page-ref" && typeof item.dest.pageNumber === "number"
            ? item.dest.pageNumber + 1
            : undefined;
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
