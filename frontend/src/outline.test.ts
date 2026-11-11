import { describe, expect, it } from "vitest";
import { flattenEpubNav, flattenPdfOutline, outlineEntriesFromHeadings } from "./outline";

describe("flattenPdfOutline", () => {
  it("keeps nesting levels and resolves page destinations", () => {
    const entries = flattenPdfOutline([
      {
        title: "Intro",
        dest: { type: "page-ref", pageNumber: 3 },
        items: [{ title: "Background", dest: { type: "page-ref", pageNumber: 5 } }],
      },
    ]);
    expect(entries.map((e) => e.level)).toEqual([1, 2]);
    expect(entries.map((e) => e.page)).toEqual([4, 6]);
  });

  it("skips entries without a title", () => {
    expect(flattenPdfOutline([{ title: "", dest: { type: "page-ref", pageNumber: 1 } }])).toHaveLength(0);
  });

  it("keeps children of an untitled parent", () => {
    const entries = flattenPdfOutline([
      { title: "  ", items: [{ title: "Child", dest: { type: "page-ref", pageNumber: 0 } }] },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ text: "Child", level: 2, page: 1 });
  });

  it("leaves the page undefined without a page destination", () => {
    const entries = flattenPdfOutline([{ title: "Links", dest: { type: "named" } }]);
    expect(entries[0].page).toBeUndefined();
  });
});

describe("flattenEpubNav", () => {
  it("keeps hrefs and nesting", () => {
    const entries = flattenEpubNav([
      { label: "Chapter 1", href: "ch1.xhtml", subitems: [{ label: "Section", href: "ch1.xhtml#s1" }] },
    ]);
    expect(entries.map((e) => e.text)).toEqual(["Chapter 1", "Section"]);
    expect(entries.map((e) => e.level)).toEqual([1, 2]);
    expect(entries.map((e) => e.href)).toEqual(["ch1.xhtml", "ch1.xhtml#s1"]);
  });
});

describe("outlineEntriesFromHeadings", () => {
  it("carries the element and a stable id", () => {
    const element = {} as HTMLElement;
    const entries = outlineEntriesFromHeadings([{ text: "Intro", level: 2, element }]);
    expect(entries[0]).toMatchObject({ id: "heading-0", text: "Intro", level: 2 });
    expect(entries[0].element).toBe(element);
  });
});
