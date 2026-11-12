import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import PluginContributions from "./PluginContributions";
import type { PluginPanel, PluginPanelSection } from "../types";

/** A plugin-contributed right-pane panel. Content is text-only; dynamic
 * panels are refreshed by asking the host to call the plugin's `panel`
 * export, never by rendering plugin HTML. */
export default function PluginPanelView({
  panel,
  pluginName,
}: {
  panel: PluginPanel;
  pluginName: string;
}) {
  const [sections, setSections] = useState<PluginPanelSection[]>(panel.sections);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    panel.dynamic ? "loading" : "ready",
  );
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!panel.dynamic) return;
    setStatus("loading");
    setError("");
    try {
      setSections(await api.pluginPanelContent(pluginName, panel.id));
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  }, [panel.dynamic, panel.id, pluginName]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel-body plugin-panel-body">
      <div className="plugin-panel-source">
        <span>来自插件「{pluginName}」</span>
        {panel.dynamic && (
          <button
            className="btn btn-small"
            onClick={() => void load()}
            disabled={status === "loading"}
          >
            刷新
          </button>
        )}
      </div>
      {status === "loading" && <div className="reader-status">正在读取面板…</div>}
      {status === "error" && (
        <div className="extension-notice error">面板加载失败：{error}</div>
      )}
      {status !== "loading" && (
        <PluginContributions panels={[{ ...panel, sections }]} />
      )}
    </div>
  );
}
