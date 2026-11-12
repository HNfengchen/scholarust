import { describe, expect, it } from "vitest";
import { pluginPanelDescriptors, pluginPanelIcon } from "./pluginPanels";
import type { PluginInfo } from "../types";

const plugin = (overrides: Partial<PluginInfo> = {}): PluginInfo => ({
  name: "术语插件",
  version: "1.0.0",
  description: "",
  enabled: true,
  apiVersion: 2,
  kind: "panel",
  permissions: { docRead: false, storage: false, http: [] },
  contributes: {
    parsers: [],
    panels: [{
      id: "about",
      title: "术语表",
      icon: "book",
      sections: [{ type: "paragraph", text: "说明" }],
    }],
  },
  ...overrides,
});

describe("plugin right-pane panels", () => {
  it("exposes enabled plugin panels with stable ids", () => {
    const panels = pluginPanelDescriptors([plugin()]);
    expect(panels).toHaveLength(1);
    expect(panels[0].id).toBe("plugin:术语插件:about");
    expect(panels[0].title).toBe("术语表");
    expect(panels[0].pluginName).toBe("术语插件");
  });

  it("hides disabled plugins and their panels", () => {
    expect(pluginPanelDescriptors([plugin({ enabled: false })])).toEqual([]);
  });

  it("only produces allowlisted icons and falls back to info", () => {
    expect(pluginPanelIcon("book")).toContain("<svg");
    expect(pluginPanelIcon("book")).toContain("<path");
    expect(pluginPanelIcon("not-a-real-icon")).toBe(pluginPanelIcon("info"));
    expect(pluginPanelIcon(undefined)).toBe(pluginPanelIcon("info"));
  });
});
