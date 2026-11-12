// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OcrPanel from "./OcrPanel";
import type { PanelContext } from "./registry";

function makeContext(overrides: Partial<PanelContext> = {}): PanelContext {
  return {
    document: null,
    content: null,
    mode: "ocr",
    structure: null,
    extractorRef: { current: null },
    structureRef: { current: null },
    outlineRef: { current: null },
    readerHostRef: { current: null },
    readingHostRef: { current: null },
    selection: null,
    selectionText: null,
    ocr: null,
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

const render = async (context: PanelContext) => {
  await act(async () => root.render(createElement(OcrPanel, context)));
};

describe("OcrPanel", () => {
  it("explains how to start when nothing was captured yet", async () => {
    await render(makeContext());
    expect(host.textContent).toContain("框选区域");
  });

  it("shows the capture while recognizing", async () => {
    await render(
      makeContext({ ocr: { status: "loading", image: "data:image/png;base64,AAAA" } }),
    );
    expect(host.querySelector(".ocr-capture")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(host.textContent).toContain("识别中");
  });

  it("shows the text with copy and translate actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const context = makeContext({
      ocr: { status: "done", text: "识别出的文字", image: "data:image/png;base64,AAAA" },
    });
    await render(context);
    expect(host.querySelector(".ocr-text")?.textContent).toBe("识别出的文字");

    const [copyButton, translateButton] = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".ocr-actions button"),
    );
    await act(async () => copyButton.click());
    expect(writeText).toHaveBeenCalledWith("识别出的文字");
    expect(copyButton.textContent).toContain("已复制");

    await act(async () => translateButton.click());
    expect(context.onTranslateSelection).toHaveBeenCalledWith("识别出的文字");
  });

  it("reports recognition failures", async () => {
    await render(makeContext({ ocr: { status: "error", message: "模型未启动" } }));
    expect(host.textContent).toContain("识别失败");
    expect(host.textContent).toContain("模型未启动");
  });
});