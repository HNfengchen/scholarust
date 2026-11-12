// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import type { DocumentInfo, PluginFormatFilter } from "../types";

const imageDoc: DocumentInfo = {
  id: "img-1",
  path: "a.png",
  title: "示意图",
  kind: "plugin:png",
  tags: [],
  collectionIds: [],
};
const markdownDoc: DocumentInfo = {
  id: "md-1",
  path: "a.md",
  title: "文稿",
  kind: "markdown",
  tags: [],
  collectionIds: [],
};
const imageFormats: PluginFormatFilter[] = [
  { key: "plugin-format:图片导入:image", label: "图片", extensions: ["png", "jpg"] },
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(documents: DocumentInfo[], pluginFormats: PluginFormatFilter[]) {
  await act(async () => {
    root.render(
      createElement(Sidebar, {
        documents,
        collections: [],
        pluginFormats,
        activeId: null,
        recentIds: [],
        opening: false,
        onOpenFiles: vi.fn(),
        onSelect: vi.fn(),
        onRemove: vi.fn(),
        onCreateCollection: vi.fn(),
        onRenameCollection: vi.fn(),
        onDeleteCollection: vi.fn(),
        onUpdateDocMeta: vi.fn(),
      }),
    );
  });
}

const formatOptions = () =>
  Array.from(host.querySelectorAll<HTMLOptionElement>(".kind-filter option")).map(
    (option) => option.textContent,
  );

describe("sidebar format filter", () => {
  it("adds a format entry contributed by an enabled parser plugin", async () => {
    await render([imageDoc, markdownDoc], imageFormats);
    expect(formatOptions()).toContain("图片（1）");
  });

  it("filters plugin documents when that format is selected", async () => {
    await render([imageDoc, markdownDoc], imageFormats);
    const select = host.querySelector<HTMLSelectElement>(".kind-filter select")!;
    await act(async () => {
      select.value = imageFormats[0].key;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector(".doc-list-header")?.textContent).toContain("图片 · 1");
    expect(host.textContent).toContain("示意图");
    expect(host.textContent).not.toContain("文稿");
  });

  it("does not invent the image format when no plugin provides it", async () => {
    await render([imageDoc], []);
    expect(formatOptions().some((label) => label?.startsWith("图片"))).toBe(false);
  });
});