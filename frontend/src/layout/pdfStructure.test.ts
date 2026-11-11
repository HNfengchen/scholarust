import { describe, expect, it } from "vitest";
import type { StructuredBlock } from "../structure";
import type { TextLine } from "./types";
import {
  extractPdfStructureReflowed,
  isBandLine,
  isPageNumberText,
  isRunningNumber,
  mergeAcrossPages,
  normalizeRunningText,
  referenceChunks,
  referenceText,
  repeatedBandTexts,
  runningKey,
  sortChunkEntries,
} from "./pdfStructure";
import type { KeptLine, PageLines } from "./pdfStructure";

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

describe("runningKey", () => {
  it("masks the digits, so the page numbers of the pages are one head", () => {
    expect(runningKey("1 / 20")).toBe(runningKey("2 / 20"));
    expect(runningKey("  12  ")).toBe("#");
  });

  it("keeps the words apart", () => {
    expect(runningKey("Draft")).not.toBe(runningKey("Proof"));
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
    expect(repeated.has("# / #")).toBe(true);
  });

  it("counts the page numbers of the pages as one head", () => {
    const repeated = repeatedBandTexts(pages(["1 / 5", "2 / 5", "3 / 5", "4 / 5", "5 / 5"]), 5);
    expect(repeated.has("# / #")).toBe(true);
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
    const repeated = new Set(["# / #"]);
    expect(isRunningNumber(line(20, "1 / 5"), HEIGHT, repeated)).toBe(true);
  });

  it("keeps a running text that is not a page number", () => {
    expect(isRunningNumber(line(20, "Draft"), HEIGHT, new Set(["Draft"]))).toBe(false);
  });

  it("keeps a page number that does not run on many pages", () => {
    expect(isRunningNumber(line(20, "1 / 5"), HEIGHT, new Set())).toBe(false);
  });

  it("keeps a page number in the body of the page", () => {
    expect(isRunningNumber(line(400, "1 / 5"), HEIGHT, new Set(["# / #"]))).toBe(false);
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

describe("referenceChunks", () => {
  const kept = (page: number, column: number, text: string): KeptLine => ({
    line: line(0, text),
    page,
    column,
  });

  it("splits the section into the columns of the pages", () => {
    const chunks = referenceChunks([
      kept(1, 0, "[1] Smith"),
      kept(1, 0, "[2] Jones"),
      kept(1, 1, "[3] Brown"),
      kept(2, 0, "[4] Green"),
    ]);
    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 1, 1]);
    expect(chunks[1][0].line.text).toBe("[3] Brown");
  });

  it("keeps one chunk when the section runs through a page", () => {
    const chunks = referenceChunks([kept(1, 0, "[1] Smith"), kept(1, 0, "[2] Jones")]);
    expect(chunks).toHaveLength(1);
  });
});

describe("sortChunkEntries", () => {
  it("puts the numbered entries in the order of their number", () => {
    const sorted = sortChunkEntries([
      { label: "[3]", number: 3, text: "Third" },
      { label: "[1]", number: 1, text: "First" },
      { label: "[2]", number: 2, text: "Second" },
    ]);
    expect(sorted.map((entry) => entry.label)).toEqual(["[1]", "[2]", "[3]"]);
  });

  it("keeps an entry without a number in its place", () => {
    const sorted = sortChunkEntries([
      { label: null, number: null, text: "the tail of the first entry" },
      { label: "[2]", number: 2, text: "Second" },
    ]);
    expect(sorted[0].text).toBe("the tail of the first entry");
    expect(sorted[1].label).toBe("[2]");
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

  it("joins a reference entry that runs over a page break", () => {
    const merged = mergeAcrossPages([
      block("reference", "[1] Smith. A very long title that", 5),
      block("reference", "runs on to the next page.", 6),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("[1] Smith. A very long title that runs on to the next page.");
    expect(merged[0].page).toBe(5);
  });
});

function stubPage(lines: string[], height = 800) {
  return {
    getViewport: () => ({ width: 600, height }),
    getTextContent: async () => ({
      items: lines.map((text, index) => ({
        str: text,
        transform: [1, 0, 0, 10, 40, height - 100 - index * 20],
        width: text.length * 5,
        height: 10,
        dir: "ltr",
        fontName: "f1",
        hasEOL: false,
      })),
    }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
    objs: { get: () => undefined },
    commonObjs: { get: () => undefined },
  };
}

describe("extractPdfStructureReflowed", () => {
  it("recognizes a first-page title below the level-one font threshold", async () => {
    const texts = ["A Study of Materials", "Alex Smith", "Abstract", "A detailed summary of the study.", "1 Introduction", "The main text of this paper begins here."];
    const page = stubPage(texts);
    const content = await page.getTextContent();
    content.items[0].transform[3] = 15;
    content.items[0].height = 15;
    page.getTextContent = async () => content;
    const structure = await extractPdfStructureReflowed({ numPages: 1, getPage: async () => page } as never);
    expect(structure.blocks.map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: "title", text: texts[0] },
      { kind: "meta", text: texts[1] },
      { kind: "heading", text: texts[2] },
      { kind: "abstract", text: texts[3] },
      { kind: "heading", text: texts[4] },
      { kind: "paragraph", text: texts[5] },
    ]);
  });

  it("keeps every input line exactly once", async () => {
    const pages = [
      ["Introduction", "First sentence of the body.", "Second sentence of the body."],
      ["Methods", "Third sentence of the body.", "Fourth sentence of the body."],
    ];
    const doc = {
      numPages: pages.length,
      getPage: async (number: number) => stubPage(pages[number - 1]),
    };

    const structure = await extractPdfStructureReflowed(doc as never);
    const text = structure.blocks
      .map((item) => `${item.text} ${item.caption ?? ""}`)
      .join("\n");

    for (const page of pages) {
      for (const inputLine of page) {
        expect(text).toContain(inputLine);
      }
    }
    expect(structure.blocks.length).toBeGreaterThan(0);
  });
});
