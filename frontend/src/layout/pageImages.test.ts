import { describe, expect, it } from "vitest";
import { OPS } from "pdfjs-dist";
import { collectImagePlacements, imageRectFromMatrix, multiplyMatrix } from "./pageImages";

describe("multiplyMatrix", () => {
  it("applies translate after scale", () => {
    const m = multiplyMatrix([1, 0, 0, 1, 0, 0], [2, 0, 0, 2, 10, 20]);
    expect(m).toEqual([2, 0, 0, 2, 10, 20]);
  });
});

describe("imageRectFromMatrix", () => {
  it("converts a PDF placement matrix to page coordinates", () => {
    const rect = imageRectFromMatrix([100, 0, 0, 50, 20, 700]);
    expect(rect).toEqual({ x: 20, y: 650, w: 100, h: 50 });
  });
});

describe("collectImagePlacements", () => {
  it("tracks the transform stack and reports page-space rectangles", () => {
    const { placements, skipped } = collectImagePlacements(
      [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      [[], [200, 0, 0, 100, 50, 500], ["img_1", 200, 100], []],
      792,
    );
    expect(skipped).toBe(0);
    expect(placements).toHaveLength(1);
    expect(imageRectFromMatrix(placements[0].matrix)).toEqual({ x: 50, y: 192, w: 200, h: 100 });
  });

  it("counts inline, masked and tiled images as skipped", () => {
    const { placements, skipped } = collectImagePlacements(
      [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject,
        OPS.paintImageXObjectRepeat,
      ],
      [["img_1", 10, 10], [{ width: 10, height: 10 }], [{ data: "mask_1" }], ["img_1", 1, 1, []]],
      792,
    );
    expect(placements).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it("restores the matrix saved by a matching save", () => {
    const { placements } = collectImagePlacements(
      [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintImageXObject],
      [[], [200, 0, 0, 100, 50, 500], ["img_1", 200, 100], [], ["img_2", 10, 10]],
      792,
    );
    expect(placements).toHaveLength(2);
    // After the restore the transform is gone, so the second image sits at the
    // untransformed origin.
    expect(imageRectFromMatrix(placements[1].matrix)).toEqual({ x: 0, y: 791, w: 1, h: 1 });
  });

  it("applies the matrix of a form XObject to the images inside it", () => {
    const { placements } = collectImagePlacements(
      [OPS.paintFormXObjectBegin, OPS.paintImageXObject, OPS.paintFormXObjectEnd],
      [[[100, 0, 0, 50, 20, 700], null], ["img_1", 100, 50], []],
      792,
    );
    expect(placements).toHaveLength(1);
    expect(imageRectFromMatrix(placements[0].matrix)).toEqual({ x: 20, y: 42, w: 100, h: 50 });
  });
});
