import {
  CONFIDENCE_THRESHOLD,
  LAYOUT_CLASSES,
  MODEL_INPUT_SIZE,
} from "./types";
import type { LayoutBox, LayoutClass, Letterbox, RawDetection, TextItem } from "./types";

export function letterboxGeometry(
  srcWidth: number,
  srcHeight: number,
  size: number = MODEL_INPUT_SIZE,
): Letterbox {
  const scale = Math.min(size / srcWidth, size / srcHeight);
  const drawW = srcWidth * scale;
  const drawH = srcHeight * scale;
  return {
    scale,
    drawW,
    drawH,
    padX: (size - drawW) / 2,
    padY: (size - drawH) / 2,
  };
}

export function parseDetections(
  output: Float32Array,
  count: number = Math.floor(output.length / 6),
  threshold: number = CONFIDENCE_THRESHOLD,
): RawDetection[] {
  const detections: RawDetection[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * 6;
    const confidence = output[offset + 4];
    if (confidence < threshold) continue;
    detections.push({
      x1: output[offset],
      y1: output[offset + 1],
      x2: output[offset + 2],
      y2: output[offset + 3],
      confidence,
      classId: Math.round(output[offset + 5]),
    });
  }
  return detections;
}

export function detectionToBox(
  det: RawDetection,
  geom: Letterbox,
  srcWidth: number,
  srcHeight: number,
): LayoutBox {
  const clampX = (v: number) => Math.min(srcWidth, Math.max(0, v));
  const clampY = (v: number) => Math.min(srcHeight, Math.max(0, v));
  const x = clampX((det.x1 - geom.padX) / geom.scale);
  const y = clampY((det.y1 - geom.padY) / geom.scale);
  const right = clampX((det.x2 - geom.padX) / geom.scale);
  const bottom = clampY((det.y2 - geom.padY) / geom.scale);
  return {
    x,
    y,
    w: Math.max(0, right - x),
    h: Math.max(0, bottom - y),
    confidence: det.confidence,
    cls: LAYOUT_CLASSES[det.classId] ?? "text",
  };
}

const TEXT_CLASSES = new Set<LayoutClass>([
  "title",
  "text",
  "figure_caption",
  "table_caption",
  "formula_caption",
  "table_footnote",
]);

function classPriority(cls: LayoutClass): number {
  if (cls === "title") return 0;
  if (cls === "text") return 1;
  return 2;
}

function contains(box: LayoutBox, cx: number, cy: number): boolean {
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

export function assignTextItems(
  items: TextItem[],
  boxes: LayoutBox[],
): { assigned: TextItem[][]; unassigned: TextItem[]; removed: number } {
  const assigned: TextItem[][] = boxes.map(() => []);
  const unassigned: TextItem[] = [];
  let removed = 0;
  for (const item of items) {
    const cx = item.x + item.width / 2;
    const cy = item.top + item.size / 2;
    if (boxes.some((box) => box.cls === "abandon" && contains(box, cx, cy))) {
      removed++;
      continue;
    }
    let best = -1;
    let bestPriority = Infinity;
    let bestArea = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (!TEXT_CLASSES.has(box.cls) || !contains(box, cx, cy)) continue;
      const priority = classPriority(box.cls);
      const area = box.w * box.h;
      if (priority < bestPriority || (priority === bestPriority && area < bestArea)) {
        best = i;
        bestPriority = priority;
        bestArea = area;
      }
    }
    if (best >= 0) assigned[best].push(item);
    else unassigned.push(item);
  }
  return { assigned, unassigned, removed };
}

export function pickCaption(
  image: LayoutBox,
  captions: LayoutBox[],
  maxDistance: number = 120,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < captions.length; i++) {
    const caption = captions[i];
    const overlap =
      Math.min(image.x + image.w, caption.x + caption.w) - Math.max(image.x, caption.x);
    if (overlap <= 0) continue;
    const distance =
      caption.y >= image.y + image.h
        ? caption.y - (image.y + image.h)
        : image.y - (caption.y + caption.h);
    if (distance > maxDistance) continue;
    const normalized = Math.max(0, distance);
    if (normalized < bestDistance) {
      best = i;
      bestDistance = normalized;
    }
  }
  return best;
}