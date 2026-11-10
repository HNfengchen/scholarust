import { describe, expect, it } from "vitest";
import { clampFontSize, nextFontSize } from "./readingSettings";

describe("reading font size", () => {
  it("clamps to 14..24", () => {
    expect(clampFontSize(10)).toBe(14);
    expect(clampFontSize(30)).toBe(24);
    expect(clampFontSize(17)).toBe(17);
  });
  it("steps without leaving the range", () => {
    expect(nextFontSize(17, 1)).toBe(18);
    expect(nextFontSize(24, 1)).toBe(24);
    expect(nextFontSize(14, -1)).toBe(14);
  });
});