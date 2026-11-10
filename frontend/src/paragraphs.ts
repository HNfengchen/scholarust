import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Rendition } from "epubjs";
import type { Paragraph } from "./types";

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote";

interface PdfLine {
  y: number;
  height: number;
  text: string;
}

export async function extractPdfParagraphs(doc: PDFDocumentProxy): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: PdfLine[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const text = item.str.trim();
      if (!text) continue;
      const y = item.transform[5];
      const height = Math.abs(item.transform[3]) || item.height || 10;
      let line = lines.find((candidate) => Math.abs(candidate.y - y) <= Math.max(1, height * 0.4));
      if (!line) {
        line = { y, height, text: "" };
        lines.push(line);
      }
      if (line.text && !/\s$/.test(line.text) && !/^\s/.test(text)) line.text += " ";
      line.text += text;
      line.height = Math.max(line.height, height);
    }
    lines.sort((a, b) => b.y - a.y);
    let buffer = "";
    let previous: PdfLine | null = null;
    const flush = () => {
      const text = buffer.trim();
      if (text) paragraphs.push({ text, page: pageNumber });
      buffer = "";
    };
    for (const line of lines) {
      if (previous && previous.y - line.y > previous.height * 1.6) flush();
      buffer = buffer ? `${buffer} ${line.text}` : line.text;
      previous = line;
    }
    flush();
  }
  return paragraphs;
}

export function extractHtmlParagraphs(root: ParentNode): Paragraph[] {
  const matched = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  const topLevel = matched.filter(
    (element) => !matched.some((other) => other !== element && other.contains(element)),
  );
  const paragraphs: Paragraph[] = [];
  for (const element of topLevel) {
    const text = (element.innerText || element.textContent || "").trim();
    if (text) paragraphs.push({ text, page: null });
  }
  return paragraphs;
}

export function extractEpubParagraphs(rendition: Rendition): Paragraph[] {
  const contents = rendition.getContents();
  const first = Array.isArray(contents) ? contents[0] : contents;
  const document = first?.document;
  if (!document) return [];
  return extractHtmlParagraphs(document);
}
