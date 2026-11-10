// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { clearHighlights, highlightMatches } from "./readerDom";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("highlightMatches", () => {
  it("wraps case-insensitive matches and returns the first", () => {
    document.body.innerHTML = "<p>The Dislocation moves and dislocation climbs.</p>";
    const p = document.querySelector("p")!;
    const first = highlightMatches(p, "dislocation");
    const marks = p.querySelectorAll("mark.search-hit");
    expect(marks.length).toBe(2);
    expect(marks[0].textContent).toBe("Dislocation");
    expect(marks[1].textContent).toBe("dislocation");
    expect(first).toBe(marks[0]);
    expect(p.textContent).toBe("The Dislocation moves and dislocation climbs.");
  });

  it("returns null when nothing matches", () => {
    document.body.innerHTML = "<p>hello world</p>";
    const p = document.querySelector("p")!;
    expect(highlightMatches(p, "xyz")).toBeNull();
    expect(p.querySelectorAll("mark").length).toBe(0);
  });

  it("highlights inside nested inline elements", () => {
    document.body.innerHTML = "<p>a <em>dislocation</em> b</p>";
    const p = document.querySelector("p")!;
    const first = highlightMatches(p, "dislocation");
    expect(first?.textContent).toBe("dislocation");
    expect(p.querySelectorAll("mark.search-hit").length).toBe(1);
  });

  it("ignores empty queries", () => {
    document.body.innerHTML = "<p>dislocation</p>";
    const p = document.querySelector("p")!;
    expect(highlightMatches(p, "   ")).toBeNull();
  });
});

describe("clearHighlights", () => {
  it("unwraps marks and restores the original text node", () => {
    document.body.innerHTML = "<p>The dislocation moves.</p>";
    const p = document.querySelector("p")!;
    highlightMatches(p, "dislocation");
    expect(p.querySelectorAll("mark").length).toBe(1);
    clearHighlights(document.body);
    expect(p.querySelectorAll("mark").length).toBe(0);
    expect(p.textContent).toBe("The dislocation moves.");
    expect(p.childNodes.length).toBe(1);
  });
});