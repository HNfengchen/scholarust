// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ParsedReader from "./ParsedReader";
import * as api from "../api";

vi.mock("../api", () => ({ parseDocument: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let props: ComponentProps<typeof ParsedReader>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    docId: "custom-1",
    zoom: 1,
    extractorRef: { current: null },
    structureRef: { current: null },
    readingStructureRef: { current: null },
    outlineRef: { current: null },
    onError: vi.fn(),
  };
  vi.mocked(api.parseDocument).mockResolvedValue({
    title: "Custom",
    notice: "parsed by plugin",
    blocks: [
      { id: 0, kind: "heading", text: "Chapter", level: 1 },
      { id: 1, kind: "paragraph", text: "Body text", level: 0 },
    ],
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(createElement(ParsedReader, props));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

describe("plugin parser reader", () => {
  it("shows extracted text and exposes structure, outline and paragraphs", async () => {
    await render();
    expect(host.textContent).toContain("Chapter");
    expect(host.textContent).toContain("Body text");

    const structure = await props.readingStructureRef.current!();
    expect(structure.blocks.map(({ kind, text }) => [kind, text])).toEqual([
      ["heading", "Chapter"],
      ["paragraph", "Body text"],
    ]);
    expect(structure.notice).toBe("parsed by plugin");

    const outline = await props.outlineRef.current!();
    expect(outline).toEqual([{ id: "plugin-0", text: "Chapter", level: 1 }]);
    const paragraphs = await props.extractorRef.current!();
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(["Chapter", "Body text"]);
  });

  it("honours an aborted signal without calling the parser twice", async () => {
    await render();
    const controller = new AbortController();
    controller.abort();
    await expect(props.readingStructureRef.current!(undefined, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(api.parseDocument).toHaveBeenCalledTimes(1);
  });

  it("maps figure images into the reading structure", async () => {
    vi.mocked(api.parseDocument).mockResolvedValue({
      title: "Comic",
      notice: null,
      blocks: [
        {
          id: 0,
          kind: "figure",
          text: "图 1",
          level: 0,
          image: "data:image/png;base64,AA==",
        },
      ],
    });
    await render();
    const structure = await props.readingStructureRef.current!();
    expect(structure.blocks[0]).toMatchObject({
      kind: "figure",
      image: "data:image/png;base64,AA==",
      caption: "图 1",
    });
  });

  it("reports parser failures", async () => {
    vi.mocked(api.parseDocument).mockRejectedValue(new Error("bad format"));
    await render();
    expect(props.onError).toHaveBeenCalledWith(expect.stringContaining("bad format"));
    expect(host.textContent).toContain("插件解析失败");
  });
});
