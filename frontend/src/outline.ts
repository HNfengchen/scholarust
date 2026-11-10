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

export interface PdfOutlineNode {
  title: string;
  dest?: string | unknown[] | null;
  page?: number;
  items?: PdfOutlineNode[];
}

export interface EpubNavNode {
  label: string;
  href?: string;
  subitems?: EpubNavNode[];
}

let pdfCounter = 0;
let epubCounter = 0;

export function flattenPdfOutline(nodes: PdfOutlineNode[], level = 1): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const node of nodes) {
    const title = node.title?.trim();
    if (title) {
      entries.push({
        id: `pdf-${++pdfCounter}`,
        text: title,
        level,
        page: node.page,
      });
    }
    if (node.items?.length) {
      entries.push(...flattenPdfOutline(node.items, level + 1));
    }
  }
  return entries;
}

export function flattenEpubNav(nodes: EpubNavNode[], level = 1): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const node of nodes) {
    const label = node.label?.trim();
    if (label) {
      entries.push({
        id: `epub-${++epubCounter}`,
        text: label,
        level,
        href: node.href,
      });
    }
    if (node.subitems?.length) {
      entries.push(...flattenEpubNav(node.subitems, level + 1));
    }
  }
  return entries;
}

export function outlineEntriesFromHeadings(
  headings: Array<{ text: string; level: number; element: HTMLElement }>,
): OutlineEntry[] {
  return headings.map((heading, index) => ({
    id: `html-${index}`,
    text: heading.text,
    level: heading.level,
    element: heading.element,
  }));
}