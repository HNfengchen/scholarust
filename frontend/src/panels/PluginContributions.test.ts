// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PluginContributions from "./PluginContributions";
import type { PluginPanel } from "../types";

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

const panel = (): PluginPanel => ({
  id: "about",
  title: "材料术语",
  description: "只读说明",
  sections: [
    { type: "paragraph", text: "插件说明" },
    { type: "list", items: ["退火", "淬火"] },
    { type: "keyValue", items: [{ key: "版本", value: "1.0" }] },
  ],
});

/** React tracks input values, so use the native setter before dispatching. */
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("declarative plugin content", () => {
  it("renders text sections without injecting markup", async () => {
    const malicious: PluginPanel = {
      ...panel(),
      sections: [{ type: "paragraph", text: "<img src=x onerror=alert(1)>" }],
    };
    await act(async () => root.render(createElement(PluginContributions, { panels: [malicious] })));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("renders paragraphs, lists and key/value pairs", async () => {
    await act(async () => root.render(createElement(PluginContributions, { panels: [panel()] })));
    expect(host.querySelectorAll("li")).toHaveLength(2);
    expect(host.querySelector("dt")?.textContent).toBe("版本");
    expect(host.querySelector("dd")?.textContent).toBe("1.0");
    expect(host.textContent).toContain("插件说明");
  });

  it("renders nothing when the plugin contributes no panels", async () => {
    await act(async () => root.render(createElement(PluginContributions, { panels: [] })));
    expect(host.innerHTML).toBe("");
  });

  it("turns action buttons into plugin calls", async () => {
    const onAction = vi.fn();
    const panel: PluginPanel = {
      id: "tools",
      title: "工具",
      sections: [
        {
          type: "actions",
          items: [
            { id: "refresh", label: "刷新", tone: "primary" },
            { id: "clear", label: "清空", tone: "danger" },
          ],
        },
      ],
    };
    await act(async () => root.render(createElement(PluginContributions, { panels: [panel], onAction })));
    const [refresh, clear] = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
    await act(async () => refresh.click());
    expect(onAction).toHaveBeenCalledWith("tools", "refresh");
    await act(async () => clear.click());
    expect(onAction).toHaveBeenCalledWith("tools", "clear");

    // Without a handler (extension preview) the buttons stay inert.
    await act(async () => root.render(createElement(PluginContributions, { panels: [panel] })));
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  });

  it("submits form fields with typed values", async () => {
    const onAction = vi.fn();
    const panel: PluginPanel = {
      id: "settings",
      title: "设置",
      sections: [
        {
          type: "form",
          id: "prefs",
          submitLabel: "保存",
          fields: [
            { id: "name", label: "名称" },
            { id: "size", label: "字号", kind: "number", min: 1, max: 20 },
            { id: "enabled", label: "启用", kind: "checkbox", value: true },
          ],
        },
      ],
    };
    await act(async () => root.render(createElement(PluginContributions, { panels: [panel], onAction })));
    const name = host.querySelector<HTMLInputElement>("#settings-prefs-name")!;
    await act(async () => {
      setInputValue(name, "论文");
    });
    const size = host.querySelector<HTMLInputElement>("#settings-prefs-size")!;
    await act(async () => {
      setInputValue(size, "12");
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onAction).toHaveBeenCalledWith("settings", "prefs", {
      name: "论文",
      size: 12,
      enabled: true,
    });
  });

  it("draws bar charts as svg without plugin markup", async () => {
    const panel: PluginPanel = {
      id: "stats",
      title: "统计",
      sections: [
        {
          type: "chart",
          kind: "bar",
          title: "数量",
          labels: ["A", "B"],
          series: [{ name: "数量", values: [3, 5] }],
        },
      ],
    };
    await act(async () => root.render(createElement(PluginContributions, { panels: [panel] })));
    expect(host.querySelectorAll(".plugin-chart svg rect")).toHaveLength(2);
    expect(host.querySelector(".plugin-chart-legend")?.textContent).toContain("数量");
  });
});
