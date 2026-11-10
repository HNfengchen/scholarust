export const MODEL_INPUT_SIZE = 1024;
export const MODEL_PAD_VALUE = 114;
export const CONFIDENCE_THRESHOLD = 0.3;

export interface Letterbox {
  scale: number;
  padX: number;
  padY: number;
  drawW: number;
  drawH: number;
}

export type LayoutClass =
  | "title"
  | "text"
  | "abandon"
  | "figure"
  | "figure_caption"
  | "table"
  | "table_caption"
  | "table_footnote"
  | "formula"
  | "formula_caption";

export const LAYOUT_CLASSES: LayoutClass[] = [
  "title",
  "text",
  "abandon",
  "figure",
  "figure_caption",
  "table",
  "table_caption",
  "table_footnote",
  "formula",
  "formula_caption",
];

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  cls: LayoutClass;
}

export interface TextItem {
  x: number;
  top: number;
  width: number;
  size: number;
  str: string;
}

export interface RawDetection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  classId: number;
}