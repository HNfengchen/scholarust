// @vitest-environment happy-dom
import { act, createElement, StrictMode, useEffect } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as api from "./api";
import type Sidebar from "./components/Sidebar";
import type Toolbar from "./components/Toolbar";
import type ReadingView from "./components/ReadingView";
import type Reader from "./components/Reader";
import type { DocumentInfo, TranslationResult } from "./types";
import type { DocumentStructure } from "./structure";

let sidebar: ComponentProps<typeof Sidebar>;
let toolbar: ComponentProps<typeof Toolbar>;
let reading: ComponentProps<typeof ReadingView>;
const extract = vi.fn<(docId: string) => Promise<DocumentStructure>>();

vi.mock("./components/Sidebar", () => ({
  default: (props: typeof sidebar) => { sidebar = props; return null; },
}));
vi.mock("./components/Toolbar", () => ({
  default: (props: typeof toolbar) => { toolbar = props; return null; },
}));
vi.mock("./components/ReadingView", () => ({
  default: (props: typeof reading) => { reading = props; return null; },
}));
vi.mock("./components/Reader", () => ({
  default: ({ docId, readingStructureRef }: ComponentProps<typeof Reader>) => {
    useEffect(() => {
      readingStructureRef.current = () => extract(docId);
      return () => { readingStructureRef.current = null; };
    }, [docId, readingStructureRef]);
    return null;
  },
}));
vi.mock("./components/RightPane", () => ({ default: () => null, MIN_PANEL_WIDTH: 240 }));
vi.mock("./panels", () => ({}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./api", () => ({
  getLibrary: vi.fn(), listServices: vi.fn(), getSettings: vi.fn(), listPlugins: vi.fn(),
  getContent: vi.fn(), translateText: vi.fn(), removeDocument: vi.fn(),
  setPluginDocument: vi.fn(async () => {}),
}));

const doc = (id: string): DocumentInfo => ({
  id, title: id, path: `${id}.epub`, kind: "epub", tags: [], collectionIds: [],
});
const a = doc("a");
const b = doc("b");
const structure = (docId: string): DocumentStructure => ({
  removedLines: 0,
  blocks: Array.from({ length: 5 }, (_, index) => ({
    id: docId === "a" ? index + 1 : index + 10,
    text: `${docId}-${index}`, kind: "paragraph", page: null, level: 0,
  })),
});
function deferred() {
  let resolve!: (value: TranslationResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<TranslationResult>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const result = { raw: "source", result: "translated" };
let root: Root;
let host: HTMLDivElement;

async function select(doc: DocumentInfo) {
  await act(async () => { sidebar.onSelect(doc); });
  await act(async () => { toolbar.onModeChange("reading"); });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(api.getLibrary).mockResolvedValue({ documents: [a, b], collections: [] });
  vi.mocked(api.listServices).mockResolvedValue([]);
  vi.mocked(api.listPlugins).mockResolvedValue([]);
  vi.mocked(api.getSettings).mockResolvedValue({
    service: "", targetLang: "zh-CN", openaiEndpoint: "", openaiModel: "", openaiKey: "",
  });
  vi.mocked(api.getContent).mockImplementation(async (id) => ({
    kind: "epub", path: `${id}.epub`, html: null, raw: null,
  }));
  vi.mocked(api.removeDocument).mockResolvedValue(undefined);
  extract.mockImplementation(async (id) => structure(id));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(StrictMode, null, createElement(App))); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("document-scoped translation cache", () => {
  it("settles success, API errors and rejections in the original book without mixing books", async () => {
    const requests = [deferred(), deferred(), deferred()];
    for (const request of requests) vi.mocked(api.translateText).mockImplementationOnce(() => request.promise);
    await select(a);
    await act(async () => {
      for (const block of reading.structure!.blocks.slice(0, 3)) reading.onTranslateBlock(block);
    });
    expect(Object.values(reading.translations).map((entry) => entry.status)).toEqual([
      "loading", "loading", "loading",
    ]);
    await select(b);
    vi.mocked(api.translateText).mockResolvedValueOnce(result);
    await act(async () => { reading.onTranslateBlock(reading.structure!.blocks[0]); });
    const bTranslations = reading.translations;
    await act(async () => {
      requests[0].resolve(result);
      requests[1].resolve({ ...result, error: "service error" });
      requests[2].reject(new Error("network error"));
    });
    expect(reading.translations).toEqual(bTranslations);
    await select(a);
    expect(reading.translations).toEqual({
      1: { status: "done", result },
      2: { status: "error", message: "service error", result: { ...result, error: "service error" } },
      3: { status: "error", message: "Error: network error" },
    });
    expect(extract.mock.calls.filter(([id]) => id === a.id)).toHaveLength(1);
    await select(b);
    expect(reading.translations).toEqual(bTranslations);
  });

  it.each(["switch", "cancel"])("keeps in-flight batch results but stops scheduling after %s", async (action) => {
    const request = deferred();
    vi.mocked(api.translateText).mockImplementation(() => request.promise);
    await select(a);
    let batch!: Promise<void>;
    await act(async () => { batch = reading.onTranslateContent(); });
    expect(api.translateText).toHaveBeenCalledTimes(3);
    expect(Object.keys(reading.translations)).toHaveLength(3);
    if (action === "switch") await select(b);
    else await act(async () => { reading.onCancelBatch(); });
    await act(async () => { request.resolve(result); await batch; });
    expect(api.translateText).toHaveBeenCalledTimes(3);
    if (action === "switch") await select(a);
    expect(reading.batchRunning).toBe(false);
    expect(reading.translations).toEqual({
      1: { status: "done", result }, 2: { status: "done", result }, 3: { status: "done", result },
    });
  });

  it.each(["active", "background"])("does not recreate a removed %s book's cache on late completion", async (location) => {
    const request = deferred();
    vi.mocked(api.translateText).mockImplementation(() => request.promise);
    await select(a);
    await act(async () => { reading.onTranslateBlock(reading.structure!.blocks[0]); });
    if (location === "background") await select(b);
    await act(async () => { sidebar.onRemove(a); });
    expect(sidebar.activeId).toBe(location === "active" ? null : b.id);
    await act(async () => { request.resolve(result); });
    // Reopening the same ID must extract anew, not revive the deleted cache.
    await select(a);
    expect(extract.mock.calls.filter(([id]) => id === a.id)).toHaveLength(2);
    expect(reading.translations).toEqual({});
  });
});
