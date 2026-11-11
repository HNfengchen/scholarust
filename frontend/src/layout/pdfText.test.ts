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
});

describe("groupItemsIntoLines", () => {
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
});
