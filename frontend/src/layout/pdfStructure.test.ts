import { describe, expect, it } from "vitest";
import type { StructuredBlock } from "../structure";
import type { TextLine } from "./types";
import {
  isBandLine,
  isPageNumberText,
  isRunningNumber,
  mergeAcrossPages,
  normalizeRunningText,
  referenceText,
  repeatedBandTexts,
} from "./pdfStructure";
import type { PageLines } from "./pdfStructure";

const HEIGHT = 800;

const line = (baseline: number, text: string, size = 10, x = 0): TextLine => ({
  x,
  baseline,
  width: text.length * size * 0.5,
  size,
  text,
});

const block = (kind: StructuredBlock["kind"], text: string, page: number): StructuredBlock => ({
  id: 0,
  kind,
  text,
  page,
  level: 0,
});

describe("normalizeRunningText", () => {
  it("trims and collapses the whitespace", () => {
    expect(normalizeRunningText("  12 \n  of  20 ")).toBe("12 of 20");
  });
});

describe("isPageNumberText", () => {
  it("accepts the page-number shapes", () => {
    expect(isPageNumberText("12")).toBe(true);
    expect(isPageNumberText("12 / 20")).toBe(true);
    expect(isPageNumberText("- 12 -")).toBe(true);
    expect(isPageNumberText("第 3 页")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isPageNumberText("Introduction")).toBe(false);
    expect(isPageNumberText("12 Introduction")).toBe(false);
    expect(isPageNumberText("")).toBe(false);
  });
});

describe("isBandLine", () => {
  it("finds the lines in the top and the bottom band", () => {
    expect(isBandLine(line(20, "12"), HEIGHT)).toBe(true);
    expect(isBandLine(line(780, "12"), HEIGHT)).toBe(true);
  });

  it("keeps the lines of the body", () => {
    expect(isBandLine(line(400, "12"), HEIGHT)).toBe(false);
  });
});

describe("repeatedBandTexts", () => {
  const pages = (texts: string[]): PageLines[] =>
    texts.map((text, index) => ({
      pageNumber: index + 1,
      height: HEIGHT,
      lines: [line(20, text)],
    }));

  it("finds the texts that run on at least 40% of the pages", () => {
    const repeated = repeatedBandTexts(pages(["1 / 5", "1 / 5", "1 / 5", "2 / 5", "3 / 5"]), 5);
    expect(repeated.has("1 / 5")).toBe(true);
    expect(repeated.has("2 / 5")).toBe(false);
  });

  it("needs the text on more than one page", () => {
    const repeated = repeatedBandTexts(pages(["1 / 5"]), 5);
    expect(repeated.size).toBe(0);
  });

  it("ignores the lines outside the band", () => {
    const repeated = repeatedBandTexts(
      [
        { pageNumber: 1, height: HEIGHT, lines: [line(400, "1 / 5")] },
        { pageNumber: 2, height: HEIGHT, lines: [line(400, "1 / 5")] },
      ],
      2,
    );
    expect(repeated.size).toBe(0);
  });
});

describe("isRunningNumber", () => {
  it("drops a page number that runs on many pages", () => {
    const repeated = new Set(["1 / 5"]);
    expect(isRunningNumber(line(20, "1 / 5"), HEIGHT, repeated)).toBe(true);
  });

  it("keeps a running text that is not a page number", () => {
    expect(isRunningNumber(line(20, "Draft"), HEIGHT, new Set(["Draft"]))).toBe(false);
  });

  it("keeps a page number that does not run on many pages", () => {
    expect(isRunningNumber(line(20, "1 / 5"), HEIGHT, new Set())).toBe(false);
  });

  it("keeps a page number in the body of the page", () => {
    expect(isRunningNumber(line(400, "1 / 5"), HEIGHT, new Set(["1 / 5"]))).toBe(false);
  });
});

describe("referenceText", () => {
  it("keeps the marker in front of the text", () => {
    expect(referenceText("[1]", "Smith. A paper.")).toBe("[1] Smith. A paper.");
  });

  it("leaves an entry without a marker alone", () => {
    expect(referenceText(null, "Smith. A paper.")).toBe("Smith. A paper.");
  });
});

describe("mergeAcrossPages", () => {
  it("joins a paragraph that runs over the page break", () => {
    const merged = mergeAcrossPages([
      block("paragraph", "the first half of a sentence", 1),
      block("paragraph", "and the second half.", 2),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("the first half of a sentence and the second half.");
    expect(merged[0].page).toBe(1);
  });

  it("keeps a paragraph that ends in a sentence", () => {
    const merged = mergeAcrossPages([
      block("paragraph", "A whole sentence.", 1),
      block("paragraph", "and the next one.", 2),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("keeps a block that starts with a capital", () => {
    const merged = mergeAcrossPages([
      block("paragraph", "the first half of a sentence", 1),
      block("paragraph", "The second half.", 2),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("keeps blocks of a different kind apart", () => {
    const merged = mergeAcrossPages([
      block("paragraph", "the first half of a sentence", 1),
      block("abstract", "and the second half", 2),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("keeps blocks of the same page apart", () => {
    const merged = mergeAcrossPages([
      block("paragraph", "the first half of a sentence", 1),
      block("paragraph", "and the second half", 1),
    ]);
    expect(merged).toHaveLength(2);
  });
});
