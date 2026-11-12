import { describe, expect, it } from "vitest";
import { normalizeOcrText } from "./ocrText";

describe("normalizeOcrText", () => {
  it("joins wrapped lines and keeps blank-line paragraph breaks", () => {
    expect(normalizeOcrText("Alpha line one\nline two\n\nBeta")).toBe("Alpha line one line two\n\nBeta");
  });

  it("does not insert spaces between wrapped Chinese lines", () => {
    expect(normalizeOcrText("这是一句被换行的\n中文段落")).toBe("这是一句被换行的中文段落");
  });

  it("drops bare page numbers", () => {
    expect(normalizeOcrText("正文\n\n- 12 -")).toBe("正文");
  });
});