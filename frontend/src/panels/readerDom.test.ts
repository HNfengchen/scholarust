// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearHighlights, highlightMatches, scrollToBlock } from "./readerDom";

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

describe("scrollToBlock", () => {
  it("scrolls instantly (no animation) to the matching data-block-id and flashes it", () => {
    document.body.innerHTML =
      '<div id="host"><div data-block-id="7">target</div><div data-block-id="8">other</div></div>';
    const host = document.querySelector<HTMLElement>("#host")!;
    const target = host.querySelector<HTMLElement>('[data-block-id="7"]')!;
    const other = host.querySelector<HTMLElement>('[data-block-id="8"]')!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    scrollToBlock(host, 7);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(target.classList.contains("search-flash")).toBe(true);
    expect(other.classList.contains("search-flash")).toBe(false);
  });

  it("reserves the sticky reading toolbar's height via scrollMarginTop", () => {
    document.body.innerHTML =
      '<div id="host"><div class="reading-toolbar"></div><div data-block-id="7">target</div></div>';
    const host = document.querySelector<HTMLElement>("#host")!;
    const toolbar = host.querySelector<HTMLElement>(".reading-toolbar")!;
    Object.defineProperty(toolbar, "offsetHeight", { value: 56 });
    const target = host.querySelector<HTMLElement>('[data-block-id="7"]')!;
    let marginDuringScroll: string | null = null;
    target.scrollIntoView = vi.fn(() => {
      marginDuringScroll = target.style.scrollMarginTop;
    });
    scrollToBlock(host, 7);
    expect(marginDuringScroll).toBe("56px");
    expect(target.style.scrollMarginTop).toBe("");
  });

  it("is a no-op for a missing host or block", () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector<HTMLElement>("#host")!;
    expect(() => scrollToBlock(host, 9)).not.toThrow();
    expect(() => scrollToBlock(null, 9)).not.toThrow();
    expect(host.querySelector(".search-flash")).toBeNull();
  });
});