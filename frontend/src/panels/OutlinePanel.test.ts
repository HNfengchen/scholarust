// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OutlinePanel from "./OutlinePanel";
import type { PanelContext } from "./registry";
import type { DocumentStructure } from "../structure";
import type { DocumentContent, DocumentInfo } from "../types";
import type { OutlineEntry } from "../outline";

const doc: DocumentInfo = {
  id: "d1",
  title: "d1",
  path: "d1.epub",
  kind: "epub",
  tags: [],
  collectionIds: [],
};
const epubContent: DocumentContent = { kind: "epub", path: "d1.epub", html: null, raw: null };
const pdfContent: DocumentContent = { kind: "pdf", path: "d1.pdf", html: null, raw: null };
const structure: DocumentStructure = {
  removedLines: 0,
  blocks: [
    { id: 1, kind: "title", text: "文档标题", page: null, level: 0 },
    { id: 2, kind: "paragraph", text: "正文段落", page: null, level: 0 },
    { id: 3, kind: "heading", text: "第一章", page: 2, level: 2 },
  ],
};

function makeContext(overrides: Partial<PanelContext> = {}): PanelContext {
  return {
    document: doc,
    content: epubContent,
    mode: "original",
    structure: null,
    extractorRef: { current: null },
    structureRef: { current: null },
    outlineRef: { current: null },
    readerHostRef: { current: null },
    readingHostRef: { current: null },
    selection: null,
    selectionText: null,
    services: [],
    settings: null,
    plugins: [],
    onUpdateSettings: vi.fn(),
    onSaveSettings: vi.fn(async () => true),
    onTranslateSelection: vi.fn(),
    onRefreshPlugins: vi.fn(async () => {}),
    onShowOriginal: vi.fn(),
    onJumpToBlock: vi.fn(),
    onNotify: vi.fn(),
    ...overrides,
  };
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderPanel(context: PanelContext) {
  await act(async () => {
    root.render(createElement(OutlinePanel, context));
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function outlineItems(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".outline-item"));
}

function click(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("OutlinePanel in reading mode", () => {
  it("builds the outline from the structure and scrolls without leaving reading mode", async () => {
    const readingHost = document.createElement("div");
    readingHost.innerHTML =
      '<div data-block-id="1">文档标题</div><div data-block-id="3">第一章</div>';
    document.body.append(readingHost);
    const readingHostRef = { current: readingHost };
    const context = makeContext({ mode: "reading", structure, readingHostRef });
    await renderPanel(context);

    const items = outlineItems();
    expect(items.map((item) => item.textContent)).toEqual(["文档标题", "第一章P2"]);
    const target = readingHost.querySelector<HTMLElement>('[data-block-id="3"]')!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    await act(async () => click(items[1]));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(target.classList.contains("search-flash")).toBe(true);
    expect(context.onShowOriginal).not.toHaveBeenCalled();
    expect(context.onJumpToBlock).not.toHaveBeenCalled();
  });

  it("shows loading until the structure arrives, then renders entries", async () => {
    const context = makeContext({ mode: "reading", structure: null });
    await renderPanel(context);
    expect(host.textContent).toContain("正在解析标题大纲");

    await act(async () => {
      root.render(createElement(OutlinePanel, { ...context, structure }));
      await Promise.resolve();
    });
    expect(outlineItems().map((item) => item.textContent)).toEqual(["文档标题", "第一章P2"]);
  });
});

describe("OutlinePanel in original mode", () => {
  it("keeps native reader navigation (action entries)", async () => {
    const action = vi.fn();
    const entries: OutlineEntry[] = [{ id: "nav-0", text: "Chapter 1", level: 1, action }];
    const context = makeContext({ outlineRef: { current: async () => entries } });
    await renderPanel(context);

    await act(async () => click(outlineItems()[0]));
    expect(context.onShowOriginal).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(context.onJumpToBlock).not.toHaveBeenCalled();
  });

  it("falls back to the structure for PDFs without bookmarks", async () => {
    const readerHost = document.createElement("div");
    readerHost.innerHTML = '<div class="pdf-page" data-page-number="2">page two</div>';
    document.body.append(readerHost);
    const readerHostRef = { current: readerHost };
    const page = readerHost.querySelector<HTMLElement>(".pdf-page")!;
    const scrollIntoView = vi.fn();
    page.scrollIntoView = scrollIntoView;
    const context = makeContext({
      content: pdfContent,
      readerHostRef,
      outlineRef: { current: async () => [] },
      structureRef: { current: async () => structure },
    });
    await renderPanel(context);

    const items = outlineItems();
    expect(items.map((item) => item.textContent)).toEqual(["文档标题", "第一章P2"]);
    // A page-known entry keeps scrolling the original PDF page.
    await act(async () => {
      click(items[1]);
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(context.onShowOriginal).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(context.onJumpToBlock).not.toHaveBeenCalled();
    // A page-less entry jumps into reading mode at the matching block.
    await act(async () => click(items[0]));
    expect(context.onJumpToBlock).toHaveBeenCalledWith(1);
  });

  it("falls back to the structure for EPUB when reader and DOM yield nothing", async () => {
    vi.useFakeTimers();
    const readerHost = document.createElement("div");
    document.body.append(readerHost);
    const readerHostRef = { current: readerHost };
    const context = makeContext({
      readerHostRef,
      outlineRef: { current: async () => [] },
      structureRef: { current: async () => structure },
    });
    await act(async () => {
      root.render(createElement(OutlinePanel, context));
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    const items = outlineItems();
    expect(items.map((item) => item.textContent)).toEqual(["文档标题", "第一章P2"]);
    await act(async () => click(items[0]));
    expect(context.onJumpToBlock).toHaveBeenCalledWith(1);
    expect(context.onShowOriginal).not.toHaveBeenCalled();
  });

  it("prefers DOM headings over the structure for non-PDF documents", async () => {
    const readerHost = document.createElement("div");
    readerHost.innerHTML = "<h2>DOM 标题</h2>";
    document.body.append(readerHost);
    const readerHostRef = { current: readerHost };
    const heading = readerHost.querySelector<HTMLElement>("h2")!;
    const scrollIntoView = vi.fn();
    heading.scrollIntoView = scrollIntoView;
    const context = makeContext({
      readerHostRef,
      outlineRef: { current: async () => [] },
      structureRef: { current: async () => structure },
    });
    await renderPanel(context);

    const items = outlineItems();
    expect(items.map((item) => item.textContent)).toEqual(["DOM 标题"]);
    await act(async () => {
      click(items[0]);
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(context.onShowOriginal).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(context.onJumpToBlock).not.toHaveBeenCalled();
  });
});