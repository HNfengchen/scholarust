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
});
