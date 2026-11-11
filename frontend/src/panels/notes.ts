import type { Note } from "../types";

export function filterAndGroupNotes(notes: Note[], query: string): [string, Note[]][] {
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? notes.filter((note) => `${note.text}\n${note.quote ?? ""}`.toLowerCase().includes(needle))
    : notes;
  const sorted = [...visible].sort((a, b) => b.createdAt - a.createdAt);
  const map = new Map<string, Note[]>();
  for (const note of sorted) {
    const key = new Date(note.createdAt).toLocaleDateString();
    const list = map.get(key);
    if (list) list.push(note);
    else map.set(key, [note]);
  }
  return [...map.entries()];
}