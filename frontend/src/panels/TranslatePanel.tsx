import type { PanelContext } from "./registry";
import { useModelStatus, modelDotClass, modelStateText } from "./useModelStatus";
import { serviceHint } from "../types";

function isLocalModel(serviceId: string | undefined): boolean {
  if (!serviceId) return false;
  return serviceId === "hy-mt2" || serviceId.startsWith("hy-mt2");
}

export default function TranslatePanel({
  selection,
  services,
  settings,
  onUpdateSettings,
  onNotify,
}: PanelContext) {
  const local = isLocalModel(settings?.service);
  const model = useModelStatus(onNotify, local);

  return (
    <div className="panel-body">
      {local && (
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
        </section>
      )}

      <section className="panel-section">
        <h3>划词翻译</h3>
        {!selection && <div className="empty-hint">在阅读器中选中文字即可自动翻译</div>}
        {selection && (
          <div className="selection-result">
            <div className="selection-source">{selection.source}</div>
            {selection.status === "loading" && (
              <div className="selection-loading">
                <span className="spinner" /> 翻译中…
              </div>
            )}
            {selection.status === "error" && (
              <div className="selection-error">{selection.message ?? "翻译失败"}</div>
            )}
            {selection.status === "done" && selection.result && (
              <>
                <div className="selection-translated">
                  {selection.result.error
                    ? `翻译失败：${selection.result.error}`
                    : selection.result.result}
                </div>
                <div className="selection-meta">服务：{selection.serviceName ?? "默认"}</div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel-section">
        <h3>翻译服务</h3>
        <label>
          当前服务
          <select
            value={settings?.service ?? ""}
            onChange={(event) => onUpdateSettings({ service: event.target.value })}
            disabled={!settings}
          >
            <option value="" disabled>
              请选择服务
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
        </label>
        <div className="service-hint">{serviceHint(settings?.service)}</div>
        {settings?.service === "openai" && !settings.openaiKey && (
          <div className="service-warning">尚未填写 API Key，请在「设置」面板完成配置</div>
        )}
      </section>
    </div>
  );
}
