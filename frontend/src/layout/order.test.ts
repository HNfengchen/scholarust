import { describe, expect, it } from "vitest";
import { detectGutter, orderPageColumns, orderPageLines } from "./order";
import type { PdfTextItem } from "./pdfText";

const item = (x: number, baseline: number, width: number, size = 10, str = "x"): PdfTextItem => ({
  x, baseline, width, size, str,
});
const column = (x: number, baselines: number[]) => baselines.map((b) => item(x, b, 140));

describe("detectGutter", () => {
  it("finds the gutter between two columns", () => {
    const items = [...column(10, [100, 120, 140, 160]), ...column(250, [100, 120, 140, 160])];
    const result = detectGutter(items, 400, 500, 10);
    expect(result.gutter).not.toBeNull();
    expect(result.gutter![0]).toBe(150);
    expect(result.gutter![1]).toBe(250);
  });

  it("does not mistake word spacing for a gutter", () => {
    const items = [item(10, 100, 30), item(43, 100, 30), item(76, 100, 30)];
    expect(detectGutter(items, 400, 500, 10).gutter).toBeNull();
  });

  it("does not mistake a page margin for a gutter", () => {
    // Text ends at x=310 on a 400pt wide page: the 90pt right margin is white
    // space, but it is a margin, not a gutter between two columns.
    const items = [item(10, 100, 300), item(10, 120, 300)];
    const result = detectGutter(items, 400, 500, 10);
    expect(result.gutter).toBeNull();
    expect(result.spanning.size).toBe(0);
  });

  it("marks a centred title as spanning instead of blocking the gutter", () => {
    const items = [
      ...column(10, [100, 120, 140, 160]),
      ...column(250, [100, 120, 140, 160]),
      item(170, 60, 60, 14, "Title"),
    ];
    const result = detectGutter(items, 400, 500, 10);
    expect(result.gutter).not.toBeNull();
    expect(result.spanning.size).toBe(1);
  });
});

describe("orderPageLines", () => {
  it("keeps fragmented full-width author rows outside the body columns", () => {
    const items = [item(10, 60, 140, 10, "First author"), item(250, 60, 140, 10, "Second author"),
      ...column(10, [100, 120]), ...column(250, [100, 120])];
    const columns = orderPageColumns(items, 400, 500, 10, [200, 200], [{ x: 8, y: 48, w: 384, h: 16 }]);
    expect(columns.spanning.map((l) => l.text)).toEqual(["First author Second author"]);
    expect(columns.left).toHaveLength(2);
    expect(columns.right).toHaveLength(2);
  });

  it("reads the left column before the right column", () => {
    const items = [...column(10, [100, 120]), ...column(250, [100, 120])];
    const lines = orderPageLines(items, 400, 500, 10);
    expect(lines.map((l) => l.x)).toEqual([10, 10, 250, 250]);
  });

  it("puts a spanning title first", () => {
    const items = [
      ...column(10, [100, 120]),
      ...column(250, [100, 120]),
      item(170, 60, 60, 14, "Title"),
    ];
    const lines = orderPageLines(items, 400, 500, 10);
    expect(lines[0].text).toBe("Title");
    expect(lines.map((l) => l.x)).toEqual([170, 10, 10, 250, 250]);
  });

  it("sorts a single column by baseline", () => {
    const items = [item(10, 200, 300), item(10, 100, 300)];
    const lines = orderPageLines(items, 400, 500, 10);
    expect(lines.map((l) => l.baseline)).toEqual([100, 200]);
  });
});
