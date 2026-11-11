// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadingView from "./ReadingView";

let root: Root;
let host: HTMLDivElement;
let props: ComponentProps<typeof ReadingView>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    title: "Document", structure: { blocks: [], removedLines: 0 }, loading: false,
    extractProgress: null, translations: {}, batchRunning: false,
    onTranslateBlock: vi.fn(), onTranslateContent: vi.fn(async () => {}), onCancel: vi.fn(), onCancelBatch: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async () => { await act(async () => root.render(createElement(ReadingView, props))); };

describe("reading content", () => {
  it("renders every sanitized figure image and missing-image alternative", async () => {
    props.structure!.blocks = [
      { id: 1, kind: "figure", text: "Caption", page: null, level: 0, image: "data:image/png;base64,AAAA", html: '<figure><img src="data:image/png;base64,AAAA" alt="First"><img src="data:image/png;base64,BBBB" alt="Second"><figcaption>Caption</figcaption></figure>' },
      { id: 2, kind: "figure", text: "Missing diagram", page: null, level: 0, html: '<img alt="Missing diagram">' },
    ];
    await render();
    expect(host.querySelectorAll(".reading-figure img")).toHaveLength(3);
    expect(host.querySelector("figcaption")?.textContent).toBe("Caption");
    expect(host.querySelector('[data-block-id="2"] img')?.getAttribute("alt")).toBe("Missing diagram");
  });

  it("keeps table structure and sends full block text for translation and retry", async () => {
    const block = { id: 1, kind: "paragraph" as const, text: "Alpha\nBeta", page: null, level: 0, html: "<table><tbody><tr><td>Alpha</td><td><em>Beta</em></td></tr></tbody></table>" };
    props.structure!.blocks = [block];
    await render();
    expect(host.querySelectorAll("td")).toHaveLength(2);
    await act(async () => (host.querySelector(".block-translate-btn") as HTMLButtonElement).click());
    expect(props.onTranslateBlock).toHaveBeenCalledWith(block);
    props.translations = { 1: { status: "error", message: "Unavailable" } };
    await render();
    await act(async () => (host.querySelector(".reading-error button") as HTMLButtonElement).click());
    expect(props.onTranslateBlock).toHaveBeenCalledTimes(2);
  });
});
