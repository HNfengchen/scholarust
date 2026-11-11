import { describe, expect, it } from "vitest";
import type { TextLine } from "./types";
import { findReferenceSection, sortReferenceEntries, splitReferenceEntries } from "./references";

const line = (baseline: number, text: string, x = 0, size = 10): TextLine => ({
  x, baseline, width: text.length * size * 0.5, size, text,
});

describe("findReferenceSection", () => {
  it("finds the references heading and stops at the next heading", () => {
    const lines = [
      line(0, "Conclusion", 0, 14),
      line(40, "References", 0, 12),
      line(60, "[1] Smith et al. Paper one.", 0, 10),
      line(80, "Appendix", 0, 14),
    ];
    expect(findReferenceSection(lines, 10)).toEqual({ start: 1, end: 3 });
  });
});

describe("splitReferenceEntries", () => {
  it("splits numbered entries and keeps continuation lines", () => {
    const lines = [
      line(0, "[1] Smith et al. A very long title", 0, 10),
      line(12, "continued on the next line", 24, 10),
      line(24, "[2] Jones. Another paper.", 0, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toContain("continued on the next line");
    expect(entries[0].label).toBe("[1]");
  });

  it("splits hanging-indent entries without numbers", () => {
    const lines = [line(0, "Smith et al. Paper", 0, 10), line(12, "More text", 20, 10), line(24, "Jones. Paper", 0, 10)];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(2);
  });
});

describe("sortReferenceEntries", () => {
  it("orders by the leading number", () => {
    const entries = splitReferenceEntries(
      [line(0, "[10] Third", 0, 10), line(12, "[2] First", 0, 10), line(24, "[1] Second", 0, 10)],
      10,
    );
    expect(sortReferenceEntries(entries).map((e) => e.label)).toEqual(["[1]", "[2]", "[10]"]);
  });
});
