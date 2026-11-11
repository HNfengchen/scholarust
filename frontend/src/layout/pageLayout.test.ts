import { describe, expect, it } from "vitest";
import { gutterFromRegions, textOutsideGraphics } from "./pageLayout";
import type { PdfTextItem } from "./types";

const item = (x: number, baseline: number, str: string): PdfTextItem => ({ x, baseline, str, size: 10, width: 30 });

describe("gutterFromRegions", () => {
  it("infers a column separator independently of a spanning table", () => {
    const regions = [
      { x: 50, y: 250, w: 240, h: 300, classId: 1, confidence: 0.9 },
      { x: 305, y: 350, w: 240, h: 350, classId: 1, confidence: 0.9 },
      { x: 180, y: 60, w: 365, h: 180, classId: 5, confidence: 0.99 },
    ];
    expect(gutterFromRegions(regions, 595)).toEqual([297.5, 297.5]);
    expect(gutterFromRegions(regions.slice(0, 1), 595)).toBeUndefined();
  });
});

describe("textOutsideGraphics", () => {
  it("removes table cells without removing adjacent prose or captions", () => {
    const caption = item(0, 30, "Table 8");
    const cell = item(100, 50, "119.325");
    const prose = item(100, 220, "Conclusion");
    const reference = item(330, 230, "1. Smith (2025)");
    expect(textOutsideGraphics([caption, cell, prose, reference], [{ x: 90, y: 20, w: 400, h: 180 }]))
      .toEqual([caption, prose, reference]);
  });
  it("keeps all text when there are no detected graphics", () => {
    const items = [item(10, 20, "body")];
    expect(textOutsideGraphics(items, [])).toEqual(items);
  });
});
