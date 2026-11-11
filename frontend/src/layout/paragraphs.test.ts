import { describe, expect, it } from "vitest";
import { bodySizeOf, headingLevelForLine, isListItem, mergeLinesIntoParagraphs } from "./paragraphs";
import type { TextLine } from "./types";

const line = (baseline: number, text: string, x = 0, size = 10): TextLine => ({
  x, baseline, width: text.length * size * 0.5, size, text,
});

describe("bodySizeOf", () => {
  it("uses the most common size weighted by characters", () => {
    const lines = [line(0, "aaaa", 0, 10), line(20, "bb", 0, 12), line(40, "cccc", 0, 10)];
    expect(bodySizeOf(lines)).toBe(10);
  });
});

describe("headingLevelForLine", () => {
  it("grades by relative size", () => {
    expect(headingLevelForLine(line(0, "Title", 0, 17), 10)).toBe(1);
    expect(headingLevelForLine(line(0, "Section", 0, 13), 10)).toBe(2);
    expect(headingLevelForLine(line(0, "Sub", 0, 11), 10)).toBe(3);
    expect(headingLevelForLine(line(0, "Body text", 0, 10), 10)).toBeNull();
  });
  it("does not mistake measurements for numbered headings", () => {
    expect(headingLevelForLine(line(0, "0.09. It indicates the error", 0, 10), 10)).toBeNull();
  });
  it("detects numbered headings", () => {
    expect(headingLevelForLine(line(0, "2.1 Related work", 0, 10), 10)).toBe(2);
    expect(headingLevelForLine(line(0, "Introduction", 0, 10), 10)).toBeNull();
  });
});

describe("mergeLinesIntoParagraphs", () => {
  it("starts a new paragraph at the next column", () => {
    expect(mergeLinesIntoParagraphs([line(700, "last left line"), line(80, "first right line", 300)], 10)).toHaveLength(2);
  });
  it("splits when the line gap is large", () => {
    const groups = mergeLinesIntoParagraphs([line(0, "one"), line(12, "two"), line(60, "three")], 10);
    expect(groups.map((g) => g.map((l) => l.text).join(" "))).toEqual(["one two", "three"]);
  });

  it("splits an indented line after terminal punctuation", () => {
    const groups = mergeLinesIntoParagraphs([line(0, "one."), line(12, "two", 24)], 10);
    expect(groups.map((g) => g.map((l) => l.text).join(" "))).toEqual(["one.", "two"]);
  });

  it("joins hyphenated line breaks", () => {
    const groups = mergeLinesIntoParagraphs([line(0, "inter-"), line(12, "national")], 10);
    expect(groups.map((g) => g.map((l) => l.text).join(" "))).toEqual(["international"]);
  });
});

describe("isListItem", () => {
  it("detects plain list markers", () => {
    expect(isListItem(line(0, "- first"))).toBe(true);
    expect(isListItem(line(0, "1. first"))).toBe(true);
    expect(isListItem(line(0, "Plain paragraph text"))).toBe(false);
  });
});
