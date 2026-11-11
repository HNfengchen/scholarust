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

  it("keeps publisher notes outside the bibliography even at body size", () => {
    const lines = [line(0, "References"), line(12, "1. Smith (2025) Paper"), line(24, "Publisher’s Note Springer Nature remains neutral")];
    expect(findReferenceSection(lines, 10)).toEqual({ start: 0, end: 2 });
  });
  it("returns null when no references heading is present", () => {
    const lines = [line(0, "Conclusion", 0, 14), line(40, "[1] Smith et al. Paper one.", 0, 10)];
    expect(findReferenceSection(lines, 10)).toBeNull();
  });
});

describe("splitReferenceEntries", () => {
  it("repairs wrapped words and DOI links without joining separate entries", () => {
    const entries = splitReferenceEntries([
      line(0, "1. Smith (2025) form-"),
      line(12, "ing. https://doi.org/10.", 20),
      line(24, "1007/example", 20),
      line(36, "2. Jones (2024) Paper"),
    ], 10);
    expect(entries[0].text).toBe("Smith (2025) forming. https://doi.org/10.1007/example");
    expect(entries).toHaveLength(2);
  });
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

  it("keeps a label-like continuation inside the current entry", () => {
    const lines = [
      line(0, "[1] Smith et al. A very long title", 0, 10),
      line(12, "2020. continued on the next line", 24, 10),
      line(24, "[2] Jones. Another paper.", 0, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toContain("2020. continued on the next line");
    expect(entries[0].number).toBe(1);
    expect(sortReferenceEntries(entries).map((e) => e.label)).toEqual(["[1]", "[2]"]);
  });

  it("does not let a label-like continuation define the body margin", () => {
    const lines = [
      line(0, "Smith et al. Paper", 0, 10),
      line(12, "2020. continued on the next line", 20, 10),
      line(24, "Jones. Paper", 0, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toContain("2020. continued on the next line");
    expect(entries[0].label).toBeNull();
    expect(entries[1].text).toBe("Jones. Paper");
    expect(entries[1].label).toBeNull();
  });

  it("keeps numbered entries apart from stray lines on the left", () => {
    const lines = [
      line(0, "Table 1: results", 0, 10),
      line(12, "Table 2: results", 0, 10),
      line(24, "Table 3: results", 0, 10),
      line(36, "[1] Smith et al. Paper", 24, 10),
      line(48, "[2] Jones. Paper", 24, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.label)).toEqual([null, "[1]", "[2]"]);
    expect(entries.map((e) => e.number)).toEqual([null, 1, 2]);
  });

  it("splits numbered entries that wrap over several lines", () => {
    const lines = [
      line(0, "[1] Smith et al. Paper", 24, 10),
      line(12, "continued one", 40, 10),
      line(24, "continued two", 40, 10),
      line(36, "[2] Jones. Paper", 24, 10),
      line(48, "continued three", 40, 10),
      line(60, "continued four", 40, 10),
      line(72, "[3] Third. Paper", 24, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.label)).toEqual(["[1]", "[2]", "[3]"]);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(entries[0].text).toContain("continued one");
    expect(entries[1].text).toContain("continued three");
    expect(entries[1].text).toContain("continued four");
    expect(entries[2].text).toBe("Third. Paper");
  });

  it("does not open entries for label-shaped continuations of unnumbered entries", () => {
    const lines = [
      line(0, "Smith et al. Paper", 0, 10),
      line(12, "2020. continued", 20, 10),
      line(24, "Jones et al. Paper", 0, 10),
      line(36, "2020. continued", 20, 10),
      line(48, "Third et al. Paper", 0, 10),
      line(60, "2020. continued", 20, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.label)).toEqual([null, null, null]);
    expect(entries[0].text).toContain("2020. continued");
  });

  it("does not read the year of an APA entry as its number", () => {
    const lines = [
      line(0, "Smith, J.", 0, 10),
      line(12, "(2020). The title of the paper.", 20, 10),
      line(24, "The rest of the reference.", 20, 10),
      line(36, "Jones, A.", 0, 10),
      line(48, "(2019). Another title.", 20, 10),
      line(60, "The rest of it.", 20, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.label)).toEqual([null, null]);
    expect(entries[0].text).toContain("(2020). The title of the paper.");
  });

  it("collapses unnumbered entries that are not hanging-indented", () => {
    const lines = [line(0, "Smith et al. Paper", 0, 10), line(12, "Jones. Paper", 0, 10)];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBeNull();
  });

  it("keeps the label of the last numbered entry when a note follows on the left", () => {
    const lines = [
      line(0, "[1] A", 24, 10),
      line(12, "[2] B", 24, 10),
      line(24, "Note: correspondence", 0, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries.map((e) => e.label)).toEqual(["[1]", "[2]"]);
    expect(entries.map((e) => e.number)).toEqual([1, 2]);
  });

  it("keeps both labels when a stray line sits between two numbered entries", () => {
    const lines = [
      line(0, "[1] A", 24, 10),
      line(12, "Table 1: note", 0, 10),
      line(24, "[2] B", 24, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries.map((e) => e.label)).toEqual(["[1]", "[2]"]);
    expect(entries.map((e) => e.number)).toEqual([1, 2]);
  });

  it("keeps the label of a single numbered entry that follows a stray line", () => {
    const lines = [
      line(0, "Table 1: results", 0, 10),
      line(12, "[1] Smith et al. Paper", 24, 10),
      line(24, "continued", 40, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    const numbered = entries.filter((e) => e.number !== null);
    expect(numbered.map((e) => e.label)).toEqual(["[1]"]);
    expect(numbered[0].number).toBe(1);
  });

  it("keeps the number of a marker that sits slightly right of the margin", () => {
    const entries = splitReferenceEntries([line(0, "[1] A", 0, 10), line(12, "[2] B", 3, 10)], 10);
    expect(entries.map((e) => e.label)).toEqual(["[1]", "[2]"]);
    expect(entries.map((e) => e.number)).toEqual([1, 2]);

    const shifted = splitReferenceEntries([line(0, "[1] A", 24, 10), line(12, "[2] B", 27, 10)], 10);
    expect(shifted.map((e) => e.label)).toEqual(["[1]", "[2]"]);
    expect(shifted.map((e) => e.number)).toEqual([1, 2]);
  });

  it("infers the body margin from the labelled lines", () => {
    const lines = [
      line(0, "Table 1: results", 0, 10),
      line(12, "[1] Smith et al. Paper", 24, 10),
      line(24, "[2] Jones. Paper", 24, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries.map((e) => e.label)).toEqual([null, "[1]", "[2]"]);
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
