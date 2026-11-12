import { describe, expect, it } from "vitest";
import {
  flattenEpubNav,
  flattenPdfOutline,
  outlineEntriesFromHeadings,
  outlineEntriesFromStructure,
} from "./outline";
import type { DocumentStructure } from "./structure";

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

describe("outlineEntriesFromStructure", () => {
  it("keeps titles/headings with block anchors and clamps levels", () => {
    const structure: DocumentStructure = {
      removedLines: 0,
      blocks: [
        { id: 1, kind: "title", text: "Paper", page: null, level: 0 },
        { id: 2, kind: "paragraph", text: "body", page: null, level: 0 },
        { id: 3, kind: "heading", text: "Intro", page: 2, level: 2 },
        { id: 4, kind: "heading", text: "Deep", page: null, level: 9 },
        { id: 5, kind: "heading", text: "Unleveled", page: null, level: 0 },
      ],
    };
    const entries = outlineEntriesFromStructure(structure);
    expect(entries.map((e) => e.text)).toEqual(["Paper", "Intro", "Deep", "Unleveled"]);
    expect(entries.map((e) => e.level)).toEqual([1, 2, 6, 2]);
    expect(entries.map((e) => e.blockId)).toEqual([1, 3, 4, 5]);
    expect(entries.map((e) => e.page)).toEqual([undefined, 2, undefined, undefined]);
    expect(entries[0].id).toBe("block-1");
  });

  it("returns nothing for a structure without headings", () => {
    const structure: DocumentStructure = {
      removedLines: 0,
      blocks: [{ id: 1, kind: "paragraph", text: "body", page: null, level: 0 }],
    };
    expect(outlineEntriesFromStructure(structure)).toEqual([]);
  });
});
