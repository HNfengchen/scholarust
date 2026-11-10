import { describe, expect, it } from "vitest";
import { normalizeRelativeImageSrc } from "./images";

describe("normalizeRelativeImageSrc", () => {
  it("decodes and strips query/hash", () => {
    expect(normalizeRelativeImageSrc("figures/a%20b.png?x=1#y")).toBe("figures/a b.png");
  });
});