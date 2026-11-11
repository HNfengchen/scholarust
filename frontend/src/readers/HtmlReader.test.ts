// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mammoth from "mammoth";
import HtmlReader from "./HtmlReader";
import { resolveImage } from "../layout/images";

vi.mock("mammoth", () => ({ default: { convertToHtml: vi.fn() } }));
vi.mock("../layout/images", () => ({ resolveImage: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
let props: ComponentProps<typeof HtmlReader>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(1))));
  vi.mocked(resolveImage).mockResolvedValue("data:image/png;base64,aGVsbG8=");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    kind: "markdown", html: "<h1>Rendered</h1><p><em>body</em></p>", raw: "# Source\n**raw**", docxUrl: null,
    docId: "doc", zoom: 1, extractorRef: { current: null }, structureRef: { current: null },
    readingStructureRef: { current: null }, outlineRef: { current: null }, onError: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});
const render = async () => { await act(async () => { root.render(createElement(HtmlReader, props)); }); };

describe("HTML reader source safety", () => {
  it.each(["# Source\n**raw**", "# Source\n", "# Source\r\n**raw**\r\n", "", "<img onerror=evil()>\nend"])("keeps Markdown source verbatim without an extra newline: %j", async (raw) => {
    props.raw = raw;
    await render();
    expect(host.querySelector("pre.raw-markdown")?.textContent).toBe(raw);
    expect(host.querySelector("img")).toBeNull();
    const structure = await props.readingStructureRef.current!();
    expect(structure.blocks[1].html).toBe("<p><em>body</em></p>");
  });

  it("gives reading extraction its own signal-aware function", async () => {
    await render();
    expect(props.readingStructureRef.current).not.toBe(props.structureRef.current);
    const controller = new AbortController();
    controller.abort();
    await expect(props.readingStructureRef.current!(undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect((await props.structureRef.current!()).blocks).toHaveLength(2);
    expect((await props.outlineRef.current!())[0].text).toBe("Source");
  });

  it("rebuilds mammoth HTML before mounting and retains semantic DOCX content", async () => {
    props = { ...props, kind: "docx", docxUrl: "https://example.test/document.docx", raw: null, html: null };
    vi.mocked(mammoth.convertToHtml).mockResolvedValue({ value: '<h1 onclick="evil()">Title</h1><p style="color:red">before<strong>bold</strong><img src="a.png" alt="Diagram" onerror="evil()">after<script>evil()</script><a href="javascript:evil()">link</a></p><table><tr><td>Cell</td></tr></table>', messages: [] });
    await render();
    const content = host.querySelector(".html-reader")!;
    expect(content.querySelector("script")).toBeNull();
    expect(content.querySelector("[onclick],[onerror],[style]")).toBeNull();
    expect(content.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(content.querySelector("strong")?.textContent).toBe("bold");
    expect(content.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
    expect(content.querySelector("td")?.textContent).toBe("Cell");
    expect(resolveImage).toHaveBeenCalledTimes(1);
    const structure = await props.readingStructureRef.current!();
    expect(structure.blocks).toHaveLength(3);
    expect(structure.blocks[1].html).toContain("<strong>bold</strong><img");
    expect(props.onError).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(props.readingStructureRef.current!(undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
