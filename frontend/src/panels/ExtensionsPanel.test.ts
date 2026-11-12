// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import ExtensionsPanel from "./ExtensionsPanel";
import * as api from "../api";
import type { PluginPreview } from "../types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api", () => ({
  inspectPlugin: vi.fn(),
  importPlugin: vi.fn(),
  pluginReadme: vi.fn(),
}));

const preview: PluginPreview = {
  info: {
    name: "解析插件",
    version: "1.1.0",
    description: "",
    enabled: true,
    apiVersion: 2,
    kind: "parser",
    permissions: { docRead: true, storage: true, http: ["api.example.com"] },
    contributes: {
      panels: [],
      parsers: [{ id: "custom", extensions: ["foo"] }],
    },
  },
  digest: "a".repeat(64),
  installed: null,
  versionChange: "new",
  conflicts: [],
};

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

async function render() {
  const props = {
    plugins: [],
    onRefreshPlugins: vi.fn().mockResolvedValue(undefined),
  } as unknown as ComponentProps<typeof ExtensionsPanel>;
  await act(async () => {
    root.render(createElement(ExtensionsPanel, props));
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label),
  );
}

async function click(label: string) {
  await act(async () => {
    button(label)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

describe("plugin install consent", () => {
  it("previews permissions and digest before installing", async () => {
    vi.mocked(open).mockResolvedValue("C:/plugins/pkg.zip");
    vi.mocked(api.inspectPlugin).mockResolvedValue(preview);
    vi.mocked(api.importPlugin).mockResolvedValue(preview.info);
    await render();

    await click("导入插件包");
    expect(api.inspectPlugin).toHaveBeenCalledWith("C:/plugins/pkg.zip");
    expect(api.importPlugin).not.toHaveBeenCalled();
    expect(host.textContent).toContain("新增权限");
    expect(host.textContent).toContain("只读文档");
    expect(host.textContent).toContain("a".repeat(64));

    await click("确认安装");
    expect(api.importPlugin).toHaveBeenCalledWith("C:/plugins/pkg.zip");
  });

  it("blocks installation when an extension conflicts", async () => {
    vi.mocked(open).mockResolvedValue("C:/plugins/pkg.zip");
    vi.mocked(api.inspectPlugin).mockResolvedValue({
      ...preview,
      conflicts: [{ extension: "foo", plugin: "旧解析" }],
    });
    await render();

    await click("导入插件包");
    expect(host.textContent).toContain("无法安装");
    const confirm = button("确认安装");
    expect(confirm?.disabled).toBe(true);
    await click("确认安装");
    expect(api.importPlugin).not.toHaveBeenCalled();
  });
});
