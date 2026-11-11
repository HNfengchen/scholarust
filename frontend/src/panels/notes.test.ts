import { describe, expect, it } from "vitest";
import { filterAndGroupNotes } from "./notes";
import type { Note } from "../types";

const day1 = new Date(2026, 10, 1, 9, 0).getTime();
const day1Later = new Date(2026, 10, 1, 15, 30).getTime();
const day2 = new Date(2026, 10, 2, 10, 0).getTime();

function note(id: string, createdAt: number, text: string, quote?: string): Note {
  return { id, createdAt, text, quote };
}

describe("filterAndGroupNotes", () => {
  it("groups notes by date with newest first", () => {
    const groups = filterAndGroupNotes(
      [note("a", day1, "早"), note("b", day2, "次日"), note("c", day1Later, "晚")],
      "",
    );
    expect(groups).toHaveLength(2);
    expect(groups[0][0]).toBe(new Date(day2).toLocaleDateString());
    expect(groups[0][1].map((n) => n.id)).toEqual(["b"]);
    expect(groups[1][1].map((n) => n.id)).toEqual(["c", "a"]);
  });

  it("matches query against text and quote case-insensitively", () => {
    const notes = [
      note("a", day1, "晶界迁移", "grain boundary migration"),
      note("b", day1, "无关", undefined),
    ];
    const groups = filterAndGroupNotes(notes, "GRAIN");
    expect(groups).toHaveLength(1);
    expect(groups[0][1].map((n) => n.id)).toEqual(["a"]);
  });

  it("returns empty for no matches", () => {
    expect(filterAndGroupNotes([note("a", day1, "内容")], "不存在")).toEqual([]);
  });

  it("does not mutate the input order", () => {
    const notes = [note("a", day1, "早"), note("b", day2, "晚")];
    filterAndGroupNotes(notes, "");
    expect(notes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});