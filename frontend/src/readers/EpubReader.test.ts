// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ePub from "epubjs";
import type { Book } from "epubjs";
import EpubReader from "./EpubReader";
import { extractEpubStructure } from "../structure";

vi.mock("epubjs", () => ({ default: vi.fn() }));
vi.mock("../structure", () => ({ extractEpubStructure: vi.fn() }));
vi.mock("../paragraphs", () => ({ extractEpubParagraphs: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const fetchMock = vi.fn<typeof fetch>();
let root: Root;
let host: HTMLDivElement;
let props: ComponentProps<typeof EpubReader>;
let selected: (_cfi: string, contents: { window: Window }) => void;
const rendition = {
  themes: { fontSize: vi.fn() },
  on: vi.fn((event: string, callback: typeof selected) => { if (event === "selected") selected = callback; }),
  display: vi.fn<() => Promise<void>>(),
  prev: vi.fn(), next: vi.fn(),
};
const book = { renderTo: vi.fn(() => rendition), destroy: vi.fn() };

async function render() {
  await act(async () => { root.render(createElement(EpubReader, props)); });
}
function signalAt(index: number) {
  return fetchMock.mock.calls[index][1]?.signal;
}
function expectClearedRefs() {
  expect(props.extractorRef.current).toBeNull();
  expect(props.structureRef.current).toBeNull();
  expect(props.readingStructureRef.current).toBeNull();
  expect(props.outlineRef.current).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => new Response(new ArrayBuffer(1)));
  rendition.display.mockResolvedValue(undefined);
  vi.mocked(ePub).mockReturnValue(book as unknown as Book);
  props = {
    url: "https://example.test/a.epub", docId: "a", zoom: 1,
    extractorRef: { current: null }, structureRef: { current: null },
    readingStructureRef: { current: null }, outlineRef: { current: null },
    onSelection: vi.fn(), onError: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe("EPUB rendering lifecycle", () => {
  it("uses current callbacks and zoom without recreating the book or losing its display", async () => {
    await render();
    const oldSelection = props.onSelection;
    props = { ...props, onSelection: vi.fn(), onError: vi.fn(), zoom: 1.5 };
    await render();
    selected("cfi", { window: { getSelection: () => ({ toString: () => " selected text " }) } as unknown as Window });
    expect(props.onSelection).toHaveBeenCalledWith("selected text");
    expect(oldSelection).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ePub).toHaveBeenCalledTimes(1);
    expect(book.destroy).not.toHaveBeenCalled();
    expect(rendition.display).toHaveBeenCalledTimes(1);
    expect(rendition.themes.fontSize).toHaveBeenLastCalledWith("150%");

    // Preserve whole-book extraction and progress/cancellation forwarding.
    const progress = vi.fn();
    const signal = new AbortController().signal;
    await props.structureRef.current!();
    expect(extractEpubStructure).toHaveBeenLastCalledWith(book, { docId: "a" });
    await props.readingStructureRef.current!(progress, signal);
    expect(extractEpubStructure).toHaveBeenLastCalledWith(book, { docId: "a", onProgress: progress, signal });
  });

  it("reports a pending render failure through the latest onError", async () => {
    const display = deferred<void>();
    rendition.display.mockReturnValue(display.promise);
    await render();
    const oldError = props.onError;
    props = { ...props, onError: vi.fn() };
    await render();
    await act(async () => { display.reject(new Error("display failed")); });
    expect(oldError).not.toHaveBeenCalled();
    expect(props.onError).toHaveBeenCalledExactlyOnceWith("EPUB 渲染失败：Error: display failed");
    expect(ePub).toHaveBeenCalledTimes(1);
  });

  it.each(["url", "docId"] as const)("still replaces and destroys the book when %s changes", async (key) => {
    await render();
    const signal = signalAt(0);
    props = { ...props, [key]: "b" };
    await render();
    expect(signal?.aborted).toBe(true);
    expect(signalAt(1)?.aborted).toBe(false);
    expect(book.destroy).toHaveBeenCalledTimes(1);
    expect(ePub).toHaveBeenCalledTimes(2);
    await act(async () => { root.render(null); });
    expect(signalAt(1)?.aborted).toBe(true);
    expect(book.destroy).toHaveBeenCalledTimes(2);
    expectClearedRefs();
  });

  it("aborts an in-flight fetch on cleanup without reporting an error", async () => {
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    await render();
    const signal = signalAt(0);
    expect(signal?.aborted).toBe(false);
    await act(async () => { root.render(null); });
    expect(signal?.aborted).toBe(true);
    expect(props.onError).not.toHaveBeenCalled();
    expect(ePub).not.toHaveBeenCalled();
    expectClearedRefs();
  });

  it("does not render a stale response body after cleanup", async () => {
    const body = deferred<ArrayBuffer>();
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: () => body.promise } as Response);
    await render();
    await act(async () => { root.render(null); });
    expect(signalAt(0)?.aborted).toBe(true);
    await act(async () => { body.resolve(new ArrayBuffer(1)); });
    expect(ePub).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
    expectClearedRefs();
  });
});
