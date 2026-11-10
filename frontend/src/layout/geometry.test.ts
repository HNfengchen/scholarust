import { describe, expect, it } from "vitest";
import {
  assignTextItems,
  detectionToBox,
  letterboxGeometry,
  parseDetections,
  pickCaption,
} from "./geometry";
import type { LayoutBox, TextItem } from "./types";

const itemAt = (cx: number, cy: number): TextItem => ({
  x: cx - 5, top: cy - 5, width: 10, size: 10, str: "x",
});
const box = (x: number, y: number, w: number, h: number): LayoutBox => ({
  x, y, w, h, confidence: 1, cls: "text",
});

describe("letterbox", () => {
  it("centers a 600x800 page", () => {
    const g = letterboxGeometry(600, 800, 1024);
    expect(g.scale).toBeCloseTo(1.28);
    expect(g.drawW).toBeCloseTo(768);
    expect(g.drawH).toBeCloseTo(1024);
    expect(g.padX).toBeCloseTo(128);
    expect(g.padY).toBeCloseTo(0);
  });
});

describe("detections", () => {
  it("parses and filters by confidence", () => {
    const out = new Float32Array(12);
    out.set([100, 100, 200, 200, 0.9, 0], 0);
    out.set([300, 300, 400, 400, 0.2, 3], 6);
    expect(parseDetections(out, 2)).toHaveLength(1);
  });

  it("maps back to source pixels and class", () => {
    const g = { scale: 2, padX: 10, padY: 20, drawW: 200, drawH: 300 };
    const mapped = detectionToBox(
      { x1: 50, y1: 60, x2: 150, y2: 260, confidence: 0.9, classId: 3 },
      g, 100, 150,
    );
    expect(mapped).toMatchObject({ x: 20, y: 20, w: 50, h: 100, cls: "figure" });
    expect((mapped.x + mapped.w / 2) * g.scale + g.padX).toBeCloseTo(100, 0);
    expect((mapped.y + mapped.h / 2) * g.scale + g.padY).toBeCloseTo(160, 0);
  });
});

describe("text assignment", () => {
  it("assigns by center, drops abandon, keeps leftovers", () => {
    const boxes: LayoutBox[] = [
      { ...box(0, 0, 100, 20), cls: "title" },
      box(0, 30, 500, 500),
      { ...box(0, 600, 500, 200), cls: "figure" },
      { ...box(0, 900, 500, 50), cls: "abandon" },
    ];
    const result = assignTextItems(
      [itemAt(50, 10), itemAt(100, 100), itemAt(100, 700), itemAt(100, 920), itemAt(900, 500)],
      boxes,
    );
    expect(result.assigned[0]).toHaveLength(1);
    expect(result.assigned[1]).toHaveLength(1);
    expect(result.removed).toBe(1);
    expect(result.unassigned).toHaveLength(2);
  });
});

describe("caption picking", () => {
  it("picks the nearest overlapping caption only", () => {
    const image = box(0, 100, 400, 300);
    expect(pickCaption(image, [box(50, 420, 300, 40)])).toBe(0);
    expect(pickCaption(image, [box(50, 700, 300, 40)])).toBeNull();
    expect(pickCaption(image, [box(450, 420, 100, 40)])).toBeNull();
  });
});