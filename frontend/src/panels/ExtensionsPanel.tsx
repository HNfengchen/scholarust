import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { PanelContext } from "./registry";
import * as api from "../api";
import SafeMarkdown from "../components/SafeMarkdown";
import PluginContributions from "./PluginContributions";
import type { PluginInfo, PluginPreview, PluginVersionChange } from "../types";

interface Notice {
  text: string;
  kind: "ok" | "error";
}

function kindLabel(kind: PluginInfo["kind"]): string {
  if (kind === "panel") return "面板插件";
  if (kind === "parser") return "解析插件";
  if (kind === "translate") return "翻译插件";
  return "未知类型";
}

function permissionLabels(plugin: PluginInfo): string[] {
  const labels: string[] = [];
  if (plugin.permissions.docRead) labels.push("只读文档");
  if (plugin.permissions.storage) labels.push("私有存储");
  for (const host of plugin.permissions.http) labels.push(`网络：${host}`);
  for (const parser of plugin.contributes.parsers) {
    labels.push(`格式：${parser.extensions.map((ext) => `.${ext}`).join(" ")}`);
  }
  return labels;
}

interface Detail {
  plugin: PluginInfo;
  readme: string;
}

const VERSION_LABELS: Record<PluginVersionChange, string> = {
  new: "全新安装",
  upgrade: "升级",
  downgrade: "降级安装",
  same: "重新安装",
  different: "版本变化",
};

/** Permissions the new package adds compared to the installed version. */
function addedPermissions(preview: PluginPreview): string[] {
  const previous = preview.installed?.permissions;
  const labels: string[] = [];
  if (preview.info.permissions.docRead && !previous?.docRead) labels.push("只读文档");
  if (preview.info.permissions.storage && !previous?.storage) labels.push("私有存储");
  for (const host of preview.info.permissions.http) {
    if (!previous?.http.includes(host)) labels.push(`网络：${host}`);
  }
  return labels;
}

function addedExtensions(preview: PluginPreview): string[] {
  const previous = preview.installed;
  const labels: string[] = [];
  for (const parser of preview.info.contributes.parsers) {
    for (const extension of parser.extensions) {
      const known = previous?.contributes.parsers.some((claim) =>
        claim.extensions.some((ext) => ext.toLowerCase() === extension.toLowerCase()),
      );
      if (!known) labels.push(`格式：.${extension}`);
    }
  }
  return labels;
}

export default function ExtensionsPanel({ plugins, onRefreshPlugins }: PanelContext) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [preview, setPreview] = useState<{ path: string; data: PluginPreview } | null>(null);

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
      setPreview({ path: picked, data: await api.inspectPlugin(picked) });
    } catch (err) {
      setNotice({ text: `无法读取插件包：${String(err)}`, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const confirmImport = async () => {
    if (!preview || preview.data.conflicts.length > 0) return;
    setBusy("import");
    setNotice(null);
    try {
      const info = await api.importPlugin(preview.path);
      setPreview(null);
      await onRefreshPlugins();
      setNotice({
        text: info.kind === "translate"
          ? `插件「${info.name}」导入成功，已注册为翻译服务`
          : info.kind === "parser"
            ? `插件「${info.name}」导入成功，已注册解析格式`
            : `插件「${info.name}」导入成功`,
        kind: "ok",
      });
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
    if (!window.confirm(`确定卸载插件「${name}」吗？插件提供的服务和内容将同时移除。`)) return;
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
          统一插件格式：ZIP 包内含 plugin.json 与 .wasm 入口（Extism 沙箱），可附 README.md。
          翻译插件导出 translate 函数；面板插件用声明式内容扩展界面。所有插件都受
          内存、CPU 与调用超时限制，能力需在清单中显式声明。
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
          <div className="extension-meta">
            <span className="plugin-kind">{kindLabel(plugin.kind)}</span>
            {permissionLabels(plugin).map((label) => (
              <span key={label} className="plugin-permission">{label}</span>
            ))}
            {plugin.conflict && (
              <span className="plugin-permission plugin-conflict" title={plugin.conflict}>
                冲突：{plugin.conflict}
              </span>
            )}
          </div>
          {plugin.kind === "translate" && (
            <div className="extension-service">翻译服务 ID：plugin:{plugin.name}</div>
          )}
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

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal-card plugin-detail" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="plugin-detail-title">
                <span className="extension-name">{preview.data.info.name}</span>
                <span className="extension-version">v{preview.data.info.version}</span>
              </div>
              <button className="btn btn-small" onClick={() => setPreview(null)}>
                取消
              </button>
            </div>
            <div className="extension-desc">
              {VERSION_LABELS[preview.data.versionChange]}
              {preview.data.installed && (
                <>（已安装 v{preview.data.installed.version}）</>
              )}
              ，{kindLabel(preview.data.info.kind)}。本地插件包未签名，请确认来源可信。
            </div>
            <div className="extension-meta">
              {permissionLabels(preview.data.info).map((label) => (
                <span key={label} className="plugin-permission">{label}</span>
              ))}
            </div>
            {addedPermissions(preview.data).length > 0 && (
              <div className="plugin-preview-warning">
                新增权限：{addedPermissions(preview.data).join("、")}
              </div>
            )}
            {addedExtensions(preview.data).length > 0 && (
              <div className="plugin-preview-warning">
                新增格式：{addedExtensions(preview.data).join("、")}
              </div>
            )}
            {preview.data.versionChange === "downgrade" && (
              <div className="plugin-preview-warning">这是降级安装，旧版本功能可能回退。</div>
            )}
            {preview.data.conflicts.length > 0 ? (
              <div className="extension-notice error">
                以下扩展名已被其他启用插件占用，无法安装：
                {preview.data.conflicts
                  .map((conflict) => ` .${conflict.extension}（${conflict.plugin}）`)
                  .join("，")}
              </div>
            ) : (
              <div className="service-hint">
                包摘要 SHA-256：<code>{preview.data.digest}</code>
              </div>
            )}
            <div className="extension-actions">
              <button className="btn btn-small" onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void confirmImport()}
                disabled={busy !== null || preview.data.conflicts.length > 0}
              >
                {busy === "import" ? <span className="spinner" /> : "确认安装"}
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="extension-meta">
              <span className="plugin-kind">{kindLabel(detail.plugin.kind)}</span>
              {permissionLabels(detail.plugin).map((label) => (
                <span key={label} className="plugin-permission">{label}</span>
              ))}
            </div>
            <div className="plugin-detail-body">
              <PluginContributions panels={detail.plugin.contributes.panels} />
              {detail.readme.trim() ? (
                <SafeMarkdown markdown={detail.readme} className="markdown-body" />
              ) : detail.plugin.contributes.panels.length === 0 ? (
                <div className="empty-hint">该插件未附带 README.md 说明。</div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}