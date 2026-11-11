import { OPS } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import type { LayoutRect } from "./types";

/** Affine matrix `[a, b, c, d, e, f]` in PDF order. */
export type Matrix = [number, number, number, number, number, number];

/** An embedded bitmap together with where it sits on the page. */
export interface PlacedImage {
  rect: LayoutRect;
  dataUrl: string;
}

interface ImagePlacement {
  objId: string;
  matrix: Matrix;
}

/** The shape pdf.js hands back for a decoded image object. */
interface PdfImagePayload {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray | null;
  bitmap?: ImageBitmap;
}

/** Longest edge of the rendered bitmap, in pixels. */
const MAX_EDGE = 1600;
/** Images bigger than this multiple of the page are page decorations, not figures. */
const SIZE_TOLERANCE = 1.2;
/** How long to wait for the worker to hand over an image object, in milliseconds. */
const IMAGE_WAIT_MS = 3000;

/**
 * Multiply two matrices; `m2` acts on the point first.
 *
 * Same convention as pdf.js' own `Util.transform`, so the result can be fed
 * straight back into a pdf.js transform operator.
 */
export function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Convert a placement matrix into a page rectangle.
 *
 * The matrix is in page coordinates (origin top-left, y downwards): the image
 * is painted into the unit square, so it spans `w` along the x axis and `h`
 * upwards from its lower edge at `f`.
 */
export function imageRectFromMatrix(m: Matrix): LayoutRect {
  const w = Math.hypot(m[0], m[1]);
  const h = Math.hypot(m[2], m[3]);
  return { x: m[4], y: m[5] - h, w, h };
}

/**
 * Walk a page operator list and collect where every bitmap is painted.
 *
 * The tracked matrix starts as the flip from PDF user space (origin
 * bottom-left) into page space (origin top-left), the same flip the text
 * extraction applies, so image rectangles line up with the text lines.
 */
export function collectImagePlacements(
  fnArray: number[],
  argsArray: unknown[][],
  pageHeight: number,
): { placements: ImagePlacement[]; skipped: number } {
  const placements: ImagePlacement[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = [1, 0, 0, -1, 0, pageHeight];
  let skipped = 0;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] ?? [];
    switch (fn) {
      case OPS.save:
        stack.push(current);
        break;
      case OPS.restore:
        current = stack.pop() ?? current;
        break;
      case OPS.transform:
        current = multiplyMatrix(current, args as Matrix);
        break;
      // A form XObject carries its own matrix, which applies to everything
      // painted inside the form.
      case OPS.paintFormXObjectBegin: {
        const matrix = args[0] as Matrix | null;
        stack.push(current);
        if (matrix) current = multiplyMatrix(current, matrix);
        break;
      }
      case OPS.paintFormXObjectEnd:
        current = stack.pop() ?? current;
        break;
      case OPS.paintImageXObject:
        placements.push({ objId: String(args[0]), matrix: current });
        break;
      // Inline images carry their pixels in the operator arguments instead of
      // an object id, and masks and repeats are not plain bitmaps: all of them
      // are left to the layout model.
      case OPS.paintInlineImageXObject:
      case OPS.paintInlineImageXObjectGroup:
      case OPS.paintImageMaskXObject:
      case OPS.paintImageMaskXObjectGroup:
      case OPS.paintImageMaskXObjectRepeat:
      case OPS.paintSolidColorImageMask:
      case OPS.paintImageXObjectRepeat:
        skipped++;
        break;
      // Vector graphics and tables are painted as paths; they cannot be
      // recovered as a bitmap.
      case OPS.fill:
      case OPS.eoFill:
      case OPS.stroke:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        skipped++;
        break;
      default:
        break;
    }
  }

  return { placements, skipped };
}

/**
 * Fetch a decoded image object.
 *
 * pdf.js delivers the pixels asynchronously, so an object that is not resolved
 * yet is awaited instead of being treated as missing.
 */
function readImageObject(page: PDFPageProxy, objId: string): Promise<PdfImagePayload | null> {
  // pdf.js puts globally cached images in the document-wide pool and page
  // images in the page pool; the other pool is only a fallback.
  const pools = objId.startsWith("g_") ? [page.commonObjs, page.objs] : [page.objs, page.commonObjs];
  for (const pool of pools) {
    if (!pool.has(objId)) continue;
    const data = pool.get(objId) as PdfImagePayload | null;
    if (data) return Promise.resolve(data);
  }
  // The worker hands over the pixels asynchronously, so wait for them.
  return new Promise((resolve) => {
    let settled = false;
    const finish = (data: PdfImagePayload | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => finish(null), IMAGE_WAIT_MS);
    // Only the pool that owns the id ever calls back, the other one stays quiet.
    for (const pool of pools) {
      pool.get(objId, (data: unknown) => finish((data as PdfImagePayload) ?? null));
    }
  });
}

/**
 * Render an image object onto an offscreen canvas and return it as a data URL.
 *
 * The canvas keeps the aspect ratio the page gives the image and follows the
 * resolution of the source bitmap, so figures stay sharp instead of being
 * reduced to one pixel per PDF unit.
 */
function renderImage(payload: PdfImagePayload, rect: LayoutRect): string | null {
  const sourceWidth = payload.width;
  const sourceHeight = payload.height;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;

  const source = document.createElement("canvas");
  source.width = sourceWidth;
  source.height = sourceHeight;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return null;

  if (payload.bitmap) {
    sourceCtx.drawImage(payload.bitmap, 0, 0);
  } else if (payload.data && payload.data.length === sourceWidth * sourceHeight * 4) {
    const bytes = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
    bytes.set(payload.data);
    sourceCtx.putImageData(new ImageData(bytes, sourceWidth, sourceHeight), 0, 0);
  } else {
    // A colour space or pixel format we cannot paint.
    return null;
  }

  let scale = 1;
  if (rect.w > 0 && rect.h > 0) {
    scale = Math.min(sourceWidth / rect.w, sourceHeight / rect.h);
  }
  let width = Math.max(1, Math.round(rect.w * scale));
  let height = Math.max(1, Math.round(rect.h * scale));
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    width = Math.max(1, Math.round((width * MAX_EDGE) / longest));
    height = Math.max(1, Math.round((height * MAX_EDGE) / longest));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // JPEG has no alpha channel and PDF pages are white, so paint that first.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * Extract the embedded bitmaps of a page together with their placement.
 *
 * Returns the placed images and the number of graphics that were left out
 * (vector paths, masks, repeats, inline images, undecodable data), so the
 * caller can tell the reader that some graphics are missing.
 */
export async function extractPageImages(
  page: PDFPageProxy,
): Promise<{ images: PlacedImage[]; skipped: number }> {
  const ops = await page.getOperatorList();
  const viewport = page.getViewport({ scale: 1 });
  const { placements, skipped: skippedOps } = collectImagePlacements(
    ops.fnArray,
    ops.argsArray as unknown[][],
    viewport.height,
  );

  const placed = await Promise.all(
    placements.map(async (placement): Promise<PlacedImage | null> => {
      const rect = imageRectFromMatrix(placement.matrix);
      if (
        rect.w <= 0 ||
        rect.h <= 0 ||
        rect.w > viewport.width * SIZE_TOLERANCE ||
        rect.h > viewport.height * SIZE_TOLERANCE
      ) {
        return null;
      }
      const payload = await readImageObject(page, placement.objId);
      if (!payload) return null;
      const dataUrl = renderImage(payload, rect);
      return dataUrl ? { rect, dataUrl } : null;
    }),
  );

  const images: PlacedImage[] = [];
  let skipped = skippedOps;
  for (const image of placed) {
    if (image) images.push(image);
    else skipped++;
  }
  return { images, skipped };
}
