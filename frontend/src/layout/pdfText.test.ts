import { describe, expect, it } from "vitest";
import { groupItemsIntoLines, itemsFromTextContent } from "./pdfText";

const raw = (str: string, x: number, baseline: number, width: number, size = 10) => ({
  str, width, height: size, transform: [1, 0, 0, size, x, baseline], dir: "ltr", fontName: "F", hasEOL: false,
});

describe("itemsFromTextContent", () => {
  it("flips the PDF origin to page coordinates and drops empty items", () => {
    const items = itemsFromTextContent(
      [raw("Hello", 40, 700, 30), raw("", 10, 700, 5), raw("World", 80, 700, 30)],
      792,
    );
    expect(items).toHaveLength(2);
    expect(items[0].x).toBe(40);
    expect(items[0].baseline).toBe(92);
    expect(items[0].size).toBe(10);
  });

  it("skips whitespace-only items", () => {
    const items = itemsFromTextContent(
      [raw("Hello", 10, 700, 30), raw(" ", 45, 700, 5), raw("   ", 60, 700, 8), raw("World", 70, 700, 30)],
      792,
    );
    expect(items.map((i) => i.str)).toEqual(["Hello", "World"]);
  });

  it("falls back to the item height when the matrix carries no scale", () => {
    const items = itemsFromTextContent(
      [{ str: "Hi", width: 30, height: 12, transform: [1, 0, 0, 0, 10, 700], dir: "ltr", fontName: "F", hasEOL: false }],
      792,
    );
    expect(items[0].size).toBe(12);
  });
});

describe("groupItemsIntoLines", () => {
  it("keeps author superscripts inline without inflating the line font size", () => {
    const lines = groupItemsIntoLines([
      { x: 10, baseline: 100, width: 60, size: 10, str: "Alex Smith" },
      { x: 70, baseline: 96.4, width: 4, size: 7.5, str: "1" },
      { x: 80, baseline: 100, width: 4, size: 12, str: "·" },
      { x: 86, baseline: 100, width: 60, size: 10, str: "Jamie Chen" },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Alex Smith1 ·Jamie Chen");
    expect(lines[0].size).toBeLessThan(10.1);
  });

  it("merges items on the same baseline left to right", () => {
    const lines = groupItemsIntoLines([
      { x: 50, baseline: 100, width: 30, size: 10, str: "world" },
      { x: 10, baseline: 100, width: 30, size: 10, str: "hello" },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("hello world");
    expect(lines[0].x).toBe(10);
    expect(lines[0].width).toBe(70);
  });

  it("keeps different baselines apart", () => {
    const lines = groupItemsIntoLines([
      { x: 10, baseline: 100, width: 30, size: 10, str: "one" },
      { x: 10, baseline: 120, width: 30, size: 10, str: "two" },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  it("splits rows that exceed the baseline tolerance", () => {
    const lines = groupItemsIntoLines([
      { x: 10, baseline: 100, width: 30, size: 10, str: "one" },
      { x: 10, baseline: 104.5, width: 30, size: 10, str: "two" },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  it("keeps the baseline tolerance fixed to the first item of the row", () => {
    const lines = groupItemsIntoLines([
      { x: 10, baseline: 100, width: 30, size: 10, str: "one" },
      { x: 50, baseline: 103, width: 30, size: 10, str: "two" },
      { x: 10, baseline: 105, width: 30, size: 10, str: "three" },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["one two", "three"]);
  });

  it("joins touching items without adding a space", () => {
    const lines = groupItemsIntoLines([
      { x: 10, baseline: 100, width: 30, size: 10, str: "Hello" },
      { x: 40, baseline: 100, width: 30, size: 10, str: "World" },
    ]);
    expect(lines[0].text).toBe("HelloWorld");
  });

  it("returns lines from top to bottom", () => {
    const lines = groupItemsIntoLines([
      { x: 10, baseline: 200, width: 30, size: 10, str: "second" },
      { x: 10, baseline: 100, width: 30, size: 10, str: "first" },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["first", "second"]);
  });
});
