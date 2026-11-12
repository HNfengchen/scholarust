import { useEffect, useState } from "react";
import type { PanelContext } from "./registry";
import { useOcrModel, useModelStatus, modelDotClass, modelStateText } from "./useModelStatus";
import { serviceHint } from "../types";
import type { Settings } from "../types";

export default function SettingsPanel({
  settings,
  services,
  plugins,
  onSaveSettings,
  onNotify,
}: PanelContext) {
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const model = useModelStatus(onNotify);
  const ocr = useOcrModel();
  const middlewareNames = plugins
    .filter((plugin) => plugin.enabled && plugin.kind === "middleware")
    .map((plugin) => plugin.name);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const patch = (changes: Partial<Settings>) => {
    setDraft((prev) => (prev ? { ...prev, ...changes } : prev));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    const ok = await onSaveSettings(draft);
    setSaving(false);
    if (ok) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="panel-body">
      <section className="panel-section">
        <h3>翻译设置</h3>
        <label>
          翻译服务
          <select
            value={draft?.service ?? ""}
            onChange={(event) => patch({ service: event.target.value })}
            disabled={!draft}
          >
            <option value="" disabled>
              请选择服务
            </option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
            {draft?.service && !services.some((service) => service.id === draft.service) && (
              <option value={draft.service}>{draft.service}</option>
            )}
          </select>
        </label>
        <div className="service-hint">{serviceHint(draft?.service)}</div>
        {middlewareNames.length > 0 && (
          <div className="service-hint">
            术语中间层：{middlewareNames.join("、")}（每次翻译后自动校正译文）
          </div>
        )}
        {draft?.service === "openai" && (
          <>
            <div className="settings-group-title">OpenAI 兼容接口</div>
            <label>
              Endpoint
              <input
                type="text"
                value={draft?.openaiEndpoint ?? ""}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => patch({ openaiEndpoint: event.target.value })}
                disabled={!draft}
              />
            </label>
            <label>
              Model
              <input
                type="text"
                value={draft?.openaiModel ?? ""}
                placeholder="gpt-4o-mini"
                onChange={(event) => patch({ openaiModel: event.target.value })}
                disabled={!draft}
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={draft?.openaiKey ?? ""}
                placeholder="sk-…"
                onChange={(event) => patch({ openaiKey: event.target.value })}
                disabled={!draft}
              />
            </label>
          </>
        )}
        <button
          className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={!draft || saving}
        >
          {saving ? "保存中…" : saved ? "已保存" : "保存设置"}
        </button>
      </section>

      <section className="panel-section">
        <h3>本地模型</h3>
        <div className="model-card">
          <span className={modelDotClass(model.status, model.busy)} />
          <span className="model-detail">{modelStateText(model.status, model.busy)}</span>
          <div className="model-actions">
            <button
              className="btn"
              onClick={() => void model.start()}
              disabled={model.busy !== null || model.status?.running === true}
            >
              {model.busy === "start" ? (
                <>
                  <span className="spinner" /> 启动中
                </>
              ) : (
                "启动"
              )}
            </button>
            <button
              className="btn"
              onClick={() => void model.stop()}
              disabled={model.busy !== null || model.status?.running !== true}
            >
              {model.busy === "stop" ? (
                <>
                  <span className="spinner" /> 停止中
                </>
              ) : (
                "停止"
              )}
            </button>
          </div>
        </div>
        <div className="model-hint">本地 GGUF 模型（放入 models/llm 文件夹），首次启动需加载约 10-30 秒</div>
      </section>

      <section className="panel-section">
        <h3>OCR 模型（扫描件 PDF）</h3>
        <div className="model-card">
          <span className={modelDotClass(ocr.status, null)} />
          <span className="model-detail">
            {ocr.info?.available
              ? `${ocr.info.model} + ${ocr.info.mmproj}`
              : "未检测到 OCR 模型"}
          </span>
          <div className="model-actions">
            <button className="btn" onClick={() => void ocr.refresh()}>
              重新扫描
            </button>
          </div>
        </div>
        <div className="model-hint">
          {ocr.info?.available
            ? `自动扫描 ${ocr.info.dir}；在右栏打开「OCR」面板后，于 PDF 页面或图片上框选识别。${ocr.status?.running ? "推理服务运行中。" : "首次识别时自动启动。"}`
            : `将主模型 GGUF 与对应的 mmproj GGUF 放入 ${ocr.info?.dir ?? "models/ocr"} 的同一个模型文件夹（如 models/ocr/MiniCPM-OCR-1.0/），会自动扫描配对。`}
        </div>
      </section>
    </div>
  );
}
