// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PluginPanelView from "./PluginPanelView";
import * as api from "../api";
import type { PluginPanel } from "../types";

vi.mock("../api", () => ({
  pluginPanelContent: vi.fn(),
  pluginPanelAction: vi.fn(),
}));

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
  vi.unstubAllGlobals();
});

async function render(panel: PluginPanel) {
  await act(async () => {
    root.render(createElement(PluginPanelView, { panel, pluginName: "统计插件" }));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

describe("dynamic plugin panel", () => {
  it("loads live sections and refreshes them on demand", async () => {
    vi.mocked(api.pluginPanelContent).mockResolvedValue([
      { type: "paragraph", text: "实时内容" },
    ]);
    const panel: PluginPanel = {
      id: "stats",
      title: "统计",
      dynamic: true,
      sections: [{ type: "paragraph", text: "静态占位" }],
    };
    await render(panel);
    expect(api.pluginPanelContent).toHaveBeenCalledWith("统计插件", "stats");
    expect(host.textContent).toContain("实时内容");
    expect(host.textContent).not.toContain("静态占位");

    vi.mocked(api.pluginPanelContent).mockResolvedValue([
      { type: "paragraph", text: "刷新后" },
    ]);
    const refresh = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "刷新",
    );
    await act(async () => {
      refresh?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("刷新后");
    expect(api.pluginPanelContent).toHaveBeenCalledTimes(2);
  });

  it("shows an error without injecting plugin HTML", async () => {
    vi.mocked(api.pluginPanelContent).mockRejectedValue(new Error("boom"));
    await render({
      id: "stats",
      title: "统计",
      dynamic: true,
      sections: [],
    });
    expect(host.textContent).toContain("面板加载失败");
    expect(host.querySelector("script")).toBeNull();
  });

  it("runs button actions and swaps in the returned sections", async () => {
    vi.mocked(api.pluginPanelAction).mockResolvedValue({
      notice: "已刷新",
      sections: [{ type: "paragraph", text: "动作结果" }],
    });
    await render({
      id: "tools",
      title: "工具",
      sections: [
        { type: "actions", items: [{ id: "refresh", label: "刷新" }] },
      ],
    });
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (item) => item.textContent === "刷新",
    )!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    expect(api.pluginPanelAction).toHaveBeenCalledWith("统计插件", "tools", "refresh", undefined);
    expect(host.textContent).toContain("动作结果");
    expect(host.textContent).toContain("已刷新");
  });

  it("refreshes a dynamic panel when an action returns only a notice", async () => {
    vi.mocked(api.pluginPanelContent).mockResolvedValue([
      { type: "actions", items: [{ id: "save", label: "保存" }] },
    ]);
    vi.mocked(api.pluginPanelAction).mockResolvedValue({ notice: "已保存" });
    await render({
      id: "stats",
      title: "统计",
      dynamic: true,
      sections: [{ type: "actions", items: [{ id: "save", label: "保存" }] }],
    });
    vi.mocked(api.pluginPanelContent).mockResolvedValue([
      { type: "paragraph", text: "刷新后的内容" },
    ]);
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (item) => item.textContent === "保存",
    )!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("已保存");
    expect(host.textContent).toContain("刷新后的内容");
    expect(api.pluginPanelContent).toHaveBeenCalledTimes(2);
  });
});
