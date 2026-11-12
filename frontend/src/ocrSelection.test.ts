// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { computeCrop, ocrSourceOf } from "./ocrSelection";

describe("ocrSourceOf", () => {
  it("finds a PDF page canvas through the text layer", () => {
    document.body.innerHTML =
      '<div class="pdf-page"><canvas></canvas><div class="textLayer"><span id="hit">line</span></div></div>';
    const canvas = document.querySelector("canvas")!;
    canvas.width = 800;
    canvas.height = 1000;
    const source = ocrSourceOf(document.querySelector("#hit")!);
    expect(source?.element).toBe(canvas);
    expect([source?.width, source?.height]).toEqual([800, 1000]);
  });

  it("finds imported images", () => {
    document.body.innerHTML = '<figure><img id="pic" alt=""></figure>';
    const image = document.querySelector<HTMLImageElement>("#pic")!;
    Object.defineProperty(image, "naturalWidth", { value: 640 });
    Object.defineProperty(image, "naturalHeight", { value: 480 });
    const source = ocrSourceOf(image);
    expect(source?.element).toBe(image);
    expect([source?.width, source?.height]).toEqual([640, 480]);
  });

  it("ignores text areas without raster content", () => {
    document.body.innerHTML = "<p id='text'>plain</p>";
    expect(ocrSourceOf(document.querySelector("#text")!)).toBeNull();
  });
});

describe("computeCrop", () => {
  it("maps display coordinates to source pixels and adds padding", () => {
    // A 2x canvas displayed at 1000 px wide: 10 px on screen = 20 source px.
    const crop = computeCrop(2000, 3000, 1000, 1500, { left: 100, top: 50, width: 200, height: 100 });
    expect(crop).toEqual({ sx: 192, sy: 92, sw: 416, sh: 216, outW: 416, outH: 216 });
  });

  it("clamps selections that run past the element edges", () => {
    const crop = computeCrop(1000, 1000, 1000, 1000, { left: -20, top: -20, width: 1200, height: 1200 });
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBe(0);
    expect(crop.sw).toBe(1000);
    expect(crop.sh).toBe(1000);
  });

  it("caps the output size while keeping the aspect ratio", () => {
    const crop = computeCrop(4000, 3000, 1000, 750, { left: 0, top: 0, width: 1000, height: 750 });
    expect(Math.max(crop.outW, crop.outH)).toBe(1600);
    expect(crop.outW / crop.outH).toBeCloseTo(4 / 3, 2);
  });
});