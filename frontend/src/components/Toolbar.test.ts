// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Toolbar from "./Toolbar";

let root: Root;
let host: HTMLDivElement;
let props: ComponentProps<typeof Toolbar>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    title: "测试文档", services: [], settings: null, mode: "original",
    translating: false, hasDocument: true, zoom: 1,
    onZoomChange: vi.fn(), onServiceChange: vi.fn(), onTargetChange: vi.fn(),
    onModeChange: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});
const render = async () => { await act(async () => { root.render(createElement(Toolbar, props)); }); };
const modeButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".mode-switch button"));

describe("Toolbar mode switch", () => {
  it("offers a single 原文/阅读 switch without a separate reading-mode button", async () => {
    await render();
    expect(modeButtons().map((b) => b.textContent.trim())).toEqual(["原文", "阅读"]);
    expect(host.textContent).not.toContain("阅读模式");
    expect(host.querySelector(".btn-primary")).toBeNull();
  });

  it("routes both modes through onModeChange", async () => {
    await render();
    const [original, reading] = modeButtons();
    await act(async () => { reading.click(); });
    expect(props.onModeChange).toHaveBeenCalledWith("reading");
    await act(async () => { original.click(); });
    expect(props.onModeChange).toHaveBeenCalledWith("original");
  });

  it("shows parsing feedback inside the reading button while translating", async () => {
    props.translating = true;
    props.mode = "reading";
    await render();
    const reading = modeButtons()[1];
    expect(reading.querySelector(".spinner")).not.toBeNull();
    expect(reading.textContent).toContain("解析中");
    expect(reading.classList.contains("active")).toBe(true);
    expect(reading.classList.contains("parsing")).toBe(true);
    // Switching away must stay possible: the running extraction is aborted.
    expect(reading.disabled).toBe(false);
  });

  it("disables the switch when no document is open", async () => {
    props.hasDocument = false;
    await render();
    for (const button of modeButtons()) expect(button.disabled).toBe(true);
  });

  it("keeps 原文 highlighted while the OCR panel drives region selection", async () => {
    props.mode = "ocr";
    await render();
    expect(modeButtons()).toHaveLength(2);
    expect(modeButtons()[0].classList.contains("active")).toBe(true);
    expect(modeButtons()[1].classList.contains("active")).toBe(false);
  });
});