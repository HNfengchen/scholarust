import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { PanelContext } from "./registry";
import * as api from "../api";
import SafeMarkdown from "../components/SafeMarkdown";
import type { PluginInfo } from "../types";

interface Notice {
  text: string;
  kind: "ok" | "error";
}

interface Detail {
  plugin: PluginInfo;
  readme: string;
}

export default function ExtensionsPanel({ plugins, onRefreshPlugins }: PanelContext) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const handleImport = async () => {
    let picked: string | null = null;
    try {
      const result = await open({
        multiple: false,
        filters: [{ name: "ScholaRust 插件包", extensions: ["zip"] }],
      });
      picked = typeof result === "string" ? result : null;
    } catch (err) {
      setNotice({ text: `打开对话框失败：${String(err)}`, kind: "error" });
      return;
    }
    if (!picked) return;
    setBusy("import");
    setNotice(null);
    try {
      const info = await api.importPlugin(picked);
      await onRefreshPlugins();
      setNotice({ text: `插件「${info.name}」导入成功，已注册为翻译服务`, kind: "ok" });
    } catch (err) {
      setNotice({ text: `导入失败：${String(err)}`, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    setBusy(name);
    setNotice(null);
    try {
      await api.setPluginEnabled(name, enabled);
      await onRefreshPlugins();
      setNotice({ text: enabled ? `已启用「${name}」` : `已停用「${name}」`, kind: "ok" });
    } catch (err) {
      setNotice({ text: `操作失败：${String(err)}`, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (name: string) => {
    if (!window.confirm(`确定卸载插件「${name}」吗？其翻译服务将同时移除。`)) return;
    setBusy(name);
    setNotice(null);
    try {
      await api.removePlugin(name);
      await onRefreshPlugins();
      setNotice({ text: `已卸载「${name}」`, kind: "ok" });
    } catch (err) {
      setNotice({ text: `卸载失败：${String(err)}`, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleDetails = async (plugin: PluginInfo) => {
    setDetailBusy(true);
    try {
      const readme = await api.pluginReadme(plugin.name);
      setDetail({ plugin, readme });
    } catch (err) {
      setNotice({ text: `读取插件详情失败：${String(err)}`, kind: "error" });
    } finally {
      setDetailBusy(false);
    }
  };

  return (
    <div className="panel-body">
      <section className="panel-section">
        <h3>插件管理</h3>
        <button
          className="btn btn-primary extension-import-btn"
          onClick={() => void handleImport()}
          disabled={busy !== null}
        >
          {busy === "import" ? (
            <>
              <span className="spinner" /> 导入中…
            </>
          ) : (
            "导入插件包（.zip）"
          )}
        </button>
        <div className="service-hint">
          统一插件格式：ZIP 包内含 plugin.json 与 .wasm 入口（Extism 沙箱，导出 translate 函数），
          可附 README.md 说明。导入后自动注册为翻译服务，可在此启停、查看详情或卸载。
        </div>
        {notice && <div className={`extension-notice ${notice.kind}`}>{notice.text}</div>}
      </section>

      {plugins.length === 0 && (
        <div className="empty-hint">
          暂无插件。可导入项目自带的 plugins/example-translate.zip（材料专业英文术语）示例包体验。
        </div>
      )}
      {plugins.map((plugin) => (
        <div key={plugin.name} className={`extension-item${plugin.enabled ? "" : " disabled"}`}>
          <div className="extension-head">
            <span className="extension-name">{plugin.name}</span>
            <span className="extension-version">v{plugin.version}</span>
          </div>
          {plugin.description && <div className="extension-desc">{plugin.description}</div>}
          <div className="extension-service">翻译服务 ID：plugin:{plugin.name}</div>
          <div className="extension-actions">
            <label className="extension-switch">
              <input
                type="checkbox"
                checked={plugin.enabled}
                disabled={busy !== null}
                onChange={(event) => void handleToggle(plugin.name, event.target.checked)}
              />
              <span>{plugin.enabled ? "已启用" : "已停用"}</span>
            </label>
            <button
              className="btn btn-small"
              onClick={() => void handleDetails(plugin)}
              disabled={busy !== null || detailBusy}
            >
              详情
            </button>
            <button
              className="btn btn-small btn-danger"
              onClick={() => void handleRemove(plugin.name)}
              disabled={busy !== null}
            >
              {busy === plugin.name ? <span className="spinner" /> : "卸载"}
            </button>
          </div>
        </div>
      ))}

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal-card plugin-detail" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="plugin-detail-title">
                <span className="extension-name">{detail.plugin.name}</span>
                <span className="extension-version">v{detail.plugin.version}</span>
              </div>
              <button className="btn btn-small" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
            {detail.plugin.description && (
              <div className="extension-desc">{detail.plugin.description}</div>
            )}
            <div className="plugin-detail-body">
              {detail.readme.trim() ? (
                <SafeMarkdown markdown={detail.readme} className="markdown-body" />
              ) : (
                <div className="empty-hint">该插件未附带 README.md 说明。</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}