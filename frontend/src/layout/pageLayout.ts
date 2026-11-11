import type { PDFPageProxy } from "pdfjs-dist";
import type { LayoutDetection } from "../api";
import type { PdfTextItem, LayoutRect } from "./types";
import type { PlacedImage } from "./pageImages";

export type LayoutDetector = (png: Uint8Array) => Promise<LayoutDetection[]>;

function contains(rect: LayoutRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function textOutsideGraphics(items: PdfTextItem[], regions: LayoutRect[]): PdfTextItem[] {
  return items.filter((item) => !regions.some((rect) =>
    contains(rect, item.x + item.width / 2, item.baseline - item.size / 2),
  ));
}

export function gutterFromRegions(regions: LayoutDetection[], width: number): [number, number] | undefined {
  const text = regions.filter((r) => r.classId === 1 && r.confidence >= 0.5 && r.w > width * 0.28 && r.w < width * 0.55);
  const left = text.filter((r) => r.x + r.w < width * 0.54).map((r) => r.x + r.w).sort((a, b) => a - b);
  const right = text.filter((r) => r.x > width * 0.45).map((r) => r.x).sort((a, b) => a - b);
  if (!left.length || !right.length) return undefined;
  const end = left[Math.floor(left.length / 2)];
  const start = right[Math.floor(right.length / 2)];
  if (start - end < width * 0.01) return undefined;
  const middle = (end + start) / 2;
  return [middle, middle];
}

export async function extractPageLayout(
  page: PDFPageProxy,
  items: PdfTextItem[],
  detect: LayoutDetector,
  signal?: AbortSignal,
): Promise<{ items: PdfTextItem[]; images: PlacedImage[]; gutter?: [number, number]; spanning: LayoutRect[] }> {
  signal?.throwIfAborted();
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d")!;
  // Print intent avoids requestAnimationFrame suspension in hidden reader tabs.
  const render = page.render({ canvasContext: context, viewport, intent: "print" });
  const cancel = () => render.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await render.promise;
    signal?.throwIfAborted();
    const input = document.createElement("canvas");
    const ratio = 1024 / Math.max(canvas.width, canvas.height);
    input.width = Math.round(canvas.width * ratio);
    input.height = Math.round(canvas.height * ratio);
    input.getContext("2d")!.drawImage(canvas, 0, 0, input.width, input.height);
    const blob = await new Promise<Blob>((resolve, reject) => input.toBlob(
      (value) => value ? resolve(value) : reject(new Error("无法编码版面图像")), "image/png",
    ));
    const detected = await detect(new Uint8Array(await blob.arrayBuffer()));
    signal?.throwIfAborted();
    const regions = detected.map((region) => ({
      ...region,
      x: region.x * base.width / input.width,
      y: region.y * base.height / input.height,
      w: region.w * base.width / input.width,
      h: region.h * base.height / input.height,
    }));
    const graphics = regions.filter((r) => [3, 5, 8].includes(r.classId));
    const excluded: LayoutRect[] = [...graphics, ...regions.filter((r) =>
      r.classId === 2 && (r.y + r.h < base.height * 0.09 || r.y > base.height * 0.92),
    )];
    const images: PlacedImage[] = graphics.map((rect) => {
      const crop = document.createElement("canvas");
      const x = Math.max(0, Math.floor(rect.x * scale) - 2);
      const y = Math.max(0, Math.floor(rect.y * scale) - 2);
      crop.width = Math.min(canvas.width - x, Math.ceil(rect.w * scale) + 4);
      crop.height = Math.min(canvas.height - y, Math.ceil(rect.h * scale) + 4);
      crop.getContext("2d")!.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return { rect, dataUrl: crop.toDataURL("image/png") };
    });
    const gutter = gutterFromRegions(regions, base.width);
    const spanning = regions.filter((r) => ![3, 5, 8].includes(r.classId) && r.confidence >= 0.5 && r.w > base.width * 0.6);
    return { items: textOutsideGraphics(items, excluded), images, gutter, spanning };
  } finally {
    signal?.removeEventListener("abort", cancel);
    canvas.width = canvas.height = 0;
  }
}
