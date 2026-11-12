import type { ServiceInfo, Settings, ViewMode } from "../types";
import { TARGET_LANGUAGES } from "../types";

interface Props {
  title: string | null;
  services: ServiceInfo[];
  settings: Settings | null;
  mode: ViewMode;
  translating: boolean;
  hasDocument: boolean;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onServiceChange: (service: string) => void;
  onTargetChange: (target: string) => void;
  onModeChange: (mode: ViewMode) => void;
}

export default function Toolbar({
  title,
  services,
  settings,
  mode,
  translating,
  hasDocument,
  zoom,
  onZoomChange,
  onServiceChange,
  onTargetChange,
  onModeChange,
}: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-title" title={title ?? undefined}>
        {title ?? "未打开文档"}
      </div>
      <div className="toolbar-controls">
        <select
          value={settings?.service ?? ""}
          onChange={(event) => onServiceChange(event.target.value)}
          disabled={!settings}
          title="翻译服务"
        >
          <option value="" disabled>
            翻译服务
          </option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
          {settings?.service && !services.some((service) => service.id === settings.service) && (
            <option value={settings.service}>{settings.service}</option>
          )}
        </select>
        <select
          value={settings?.targetLang ?? "zh-CN"}
          onChange={(event) => onTargetChange(event.target.value)}
          disabled={!settings}
          title="目标语言"
        >
          {TARGET_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
          {settings && !TARGET_LANGUAGES.some((l) => l.value === settings.targetLang) && (
            <option value={settings.targetLang}>{settings.targetLang}</option>
          )}
        </select>
        {mode === "original" && hasDocument && (
          <div className="zoom-controls" title="原文缩放">
            <button
              className="btn btn-small"
              onClick={() => onZoomChange(zoom - 0.1)}
              disabled={zoom <= 0.5}
              title="缩小"
            >
              −
            </button>
            <button className="zoom-label" onClick={() => onZoomChange(1)} title="重置为 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="btn btn-small"
              onClick={() => onZoomChange(zoom + 0.1)}
              disabled={zoom >= 3}
              title="放大"
            >
              +
            </button>
          </div>
        )}
        <div className="mode-switch">
          <button
            className={mode !== "reading" ? "active" : ""}
            onClick={() => onModeChange("original")}
            disabled={!hasDocument}
            title="显示文档原始排版"
          >
            原文
          </button>
          <button
            className={`${mode === "reading" ? "active" : ""}${translating && mode === "reading" ? " parsing" : ""}`}
            onClick={() => onModeChange("reading")}
            disabled={!hasDocument}
            title="重排为阅读模式：过滤页眉页脚，按标题/摘要/正文/注释分块，逐块翻译"
          >
            {translating && mode === "reading" ? (
              <>
                <span className="spinner" /> 解析中…
              </>
            ) : (
              "阅读"
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
