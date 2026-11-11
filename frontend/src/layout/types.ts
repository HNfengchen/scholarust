export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Structural shape of a pdf.js text item (page.getTextContent()). */
export interface PdfJsTextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

export interface PdfTextItem {
  x: number;
  baseline: number;
  width: number;
  size: number;
  str: string;
}

export interface TextLine {
  x: number;
  baseline: number;
  width: number;
  size: number;
  text: string;
}
