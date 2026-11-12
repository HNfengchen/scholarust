import { createElement } from "react";
import type { ComponentType } from "react";
import type { PluginInfo, PluginPanel } from "../types";
import type { PanelContext, PanelDescriptor } from "./registry";
import PluginPanelView from "./PluginPanelView";

const ICON_PATHS: Record<string, string> = {
  info: "M11 9h2V7h-2v2zm0 8h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z",
  list: "M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z",
  table: "M3 3h18v18H3V3zm2 2v4h14V5H5zm0 6v4h14v-4H5zm0 6v2h14v-2H5z",
  book: "M4 4h7v16H4V4zm9 0h7v16h-7V4z",
  notes: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  sparkle: "M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z",
};

export function pluginPanelIcon(name: string | undefined): string {
  const path = ICON_PATHS[name ?? "info"] ?? ICON_PATHS.info;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
}

export interface PluginPanelDescriptor extends PanelDescriptor {
  pluginName: string;
  panel: PluginPanel;
}

/** Contributed panels from enabled plugins, as first-class right-pane panels. */
export function pluginPanelDescriptors(plugins: PluginInfo[]): PluginPanelDescriptor[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      plugin.contributes.panels.map((panel) => {
        const render: ComponentType<PanelContext> = () =>
          createElement(PluginPanelView, { panel, pluginName: plugin.name });
        return {
          id: `plugin:${plugin.name}:${panel.id}`,
          title: panel.title || plugin.name,
          icon: pluginPanelIcon(panel.icon),
          render,
          pluginName: plugin.name,
          panel,
        };
      }),
    );
}
