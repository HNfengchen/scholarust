export interface OcrRasterSource {
  element: HTMLCanvasElement | HTMLImageElement;
  /** Source pixel size (canvas buffer or the image's natural size). */
  width: number;
  height: number;
}

/**
 * Finds the raster content under the pointer. PDF pages are canvases; imported
 * or embedded pictures are `<img>` elements.
 */
export function ocrSourceOf(target: Element): OcrRasterSource | null {
  const canvas = target.closest<HTMLCanvasElement>("canvas");
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    return { element: canvas, width: canvas.width, height: canvas.height };
  }
  const pageCanvas = target.closest<HTMLElement>(".pdf-page")?.querySelector("canvas");
  if (pageCanvas && pageCanvas.width > 0 && pageCanvas.height > 0) {
    return { element: pageCanvas, width: pageCanvas.width, height: pageCanvas.height };
  }
  const image = target.closest<HTMLImageElement>("img");
  if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
    return { element: image, width: image.naturalWidth, height: image.naturalHeight };
  }
  return null;
}

export interface CropBox {
  /** Selection rectangle relative to the element's on-screen box. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropSpec {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  outW: number;
  outH: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Maps an on-screen selection to source pixels (DPR-aware) and caps the output
 * so one OCR request stays a small, model-friendly image.
 */
export function computeCrop(
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
  box: CropBox,
  padding = 4,
  maxSide = 1600,
): CropSpec {
  const scaleX = sourceWidth / displayWidth;
  const scaleY = sourceHeight / displayHeight;
  const sx = clamp(Math.floor((box.left - padding) * scaleX), 0, sourceWidth - 1);
  const sy = clamp(Math.floor((box.top - padding) * scaleY), 0, sourceHeight - 1);
  const sw = clamp(Math.ceil((box.width + padding * 2) * scaleX), 1, sourceWidth - sx);
  const sh = clamp(Math.ceil((box.height + padding * 2) * scaleY), 1, sourceHeight - sy);
  const longest = Math.max(sw, sh);
  const factor = longest > maxSide ? maxSide / longest : 1;
  return {
    sx,
    sy,
    sw,
    sh,
    outW: Math.max(1, Math.round(sw * factor)),
    outH: Math.max(1, Math.round(sh * factor)),
  };
}