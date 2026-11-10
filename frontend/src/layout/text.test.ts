import { describe, expect, it } from "vitest";
import { groupParagraphs, headingLevelForLine, itemsToLines } from "./text";

describe("itemsToLines", () => {
  it("merges items on the same baseline from left to right", () => {
    const lines = itemsToLines([
      { x: 50, top: 10, width: 20, size: 10, str: "world" },
      { x: 10, top: 10, width: 20, size: 10, str: "hello" },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("hello world");
  });
});

describe("groupParagraphs", () => {
  const line = (top: number, text: string, x = 0) => ({ x, top, size: 10, text });

  it("splits when the gap exceeds 1.45 line heights", () => {
    const paragraphs = groupParagraphs([line(0, "one"), line(10, "two"), line(30, "three")], 0, 10);
    expect(paragraphs.map((p) => p.text)).toEqual(["one two", "three"]);
  });

  it("splits on an indented line after terminal punctuation", () => {
    const paragraphs = groupParagraphs([line(0, "one."), line(10, "two", 20)], 0, 10);
    expect(paragraphs.map((p) => p.text)).toEqual(["one.", "two"]);
  });

  it("joins hyphenated line breaks", () => {
    const paragraphs = groupParagraphs([line(0, "inter-"), line(10, "national")], 0, 10);
    expect(paragraphs.map((p) => p.text)).toEqual(["international"]);
  });
});

describe("headingLevelForLine", () => {
  it("uses size thresholds and short text", () => {
    expect(headingLevelForLine({ x: 0, top: 0, size: 17, text: "Title" }, 10)).toBe(1);
    expect(headingLevelForLine({ x: 0, top: 0, size: 13, text: "Section" }, 10)).toBe(2);
    expect(headingLevelForLine({ x: 0, top: 0, size: 11, text: "Small heading" }, 10)).toBe(3);
    expect(headingLevelForLine({ x: 0, top: 0, size: 10, text: "Body" }, 10)).toBeNull();
  });
});