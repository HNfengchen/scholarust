import type { ServiceInfo, Settings, ViewMode } from "../types";
import { TARGET_LANGUAGES } from "../types";

interface Props {
  title: string | null;
  services: ServiceInfo[];
  settings: Settings | null;
  mode: ViewMode;
  translating: boolean;
  hasDocument: boolean;
  onServiceChange: (service: string) => void;
  onTargetChange: (target: string) => void;
  onBilingual: () => void;
  onModeChange: (mode: ViewMode) => void;
}

export default function Toolbar({
  title,
  services,
  settings,
  mode,
  translating,
  hasDocument,
  onServiceChange,
  onTargetChange,
  onBilingual,
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
        <div className="mode-switch">
          <button
            className={mode === "original" ? "active" : ""}
            onClick={() => onModeChange("original")}
            disabled={!hasDocument}
          >
            原文
          </button>
          <button
            className={mode === "reading" ? "active" : ""}
            onClick={() => onModeChange("reading")}
            disabled={!hasDocument || translating}
          >
            阅读
          </button>
        </div>
        <button
          className="btn btn-primary"
          onClick={onBilingual}
          disabled={!hasDocument || translating}
          title="重排为阅读模式：过滤页眉页脚，按标题/摘要/正文/注释分块，逐块翻译"
        >
          {translating ? (
            <>
              <span className="spinner" /> 解析中…
            </>
          ) : (
            "阅读模式"
          )}
        </button>
      </div>
    </header>
  );
}
