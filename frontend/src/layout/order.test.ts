import { describe, expect, it } from "vitest";
import { orderBoxes } from "./order";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("orderBoxes", () => {
  it("reads two columns left then right", () => {
    const ordered = orderBoxes(
      [box(0, 100, 100, 20), box(200, 100, 100, 20), box(0, 300, 100, 20), box(200, 300, 100, 20)],
      400, 500,
    );
    expect(ordered.map((b) => b.x)).toEqual([0, 0, 200, 200]);
  });

  it("keeps a full-width title before both columns", () => {
    const ordered = orderBoxes(
      [box(0, 0, 400, 30), box(0, 100, 150, 200), box(250, 100, 150, 200)],
      400, 500,
    );
    expect(ordered[0].y).toBe(0);
    expect(ordered.map((b) => b.x)).toEqual([0, 0, 250]);
  });

  it("reads a single column top to bottom", () => {
    const ordered = orderBoxes([box(0, 300, 400, 20), box(0, 100, 400, 20), box(0, 200, 400, 20)], 400, 500);
    expect(ordered.map((b) => b.y)).toEqual([100, 200, 300]);
  });
});