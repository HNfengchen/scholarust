import { describe, expect, it } from "vitest";
import { flattenEpubNav, flattenPdfOutline } from "./outline";

describe("flattenPdfOutline", () => {
  it("keeps levels and resolved pages, skips empty titles", () => {
    const entries = flattenPdfOutline([
      {
        title: "Intro", page: 1,
        items: [{ title: "Method", page: 3, items: [{ title: "Data", page: 4 }] }],
      },
      { title: "", page: 5 },
    ]);
    expect(entries.map((e) => [e.text, e.level, e.page])).toEqual([
      ["Intro", 1, 1],
      ["Method", 2, 3],
      ["Data", 3, 4],
    ]);
  });

  it("keeps entries whose destination could not be resolved", () => {
    expect(flattenPdfOutline([{ title: "No dest" }])[0].page).toBeUndefined();
  });
});

describe("flattenEpubNav", () => {
  it("keeps href and nesting", () => {
    const entries = flattenEpubNav([
      { label: "Chapter 1", href: "ch1.xhtml", subitems: [{ label: "Section", href: "ch1.xhtml#s1" }] },
    ]);
    expect(entries.map((e) => [e.text, e.level, e.href])).toEqual([
      ["Chapter 1", 1, "ch1.xhtml"],
      ["Section", 2, "ch1.xhtml#s1"],
    ]);
  });
});