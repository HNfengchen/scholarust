import { useState } from "react";
import type { PanelContext } from "./registry";

export default function OcrPanel({ ocr, onTranslateSelection }: PanelContext) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!ocr?.text) return;
    try {
      await navigator.clipboard.writeText(ocr.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="panel-body">
      <section className="panel-section">
        <h3>框选识别</h3>
        {!ocr && (
          <div className="empty-hint">
            打开「OCR」面板后，在 PDF 页面或图片上拖动框选区域，识别结果会显示在这里
          </div>
        )}
        {ocr && (
          <div className="selection-result">
            {ocr.image && <img className="ocr-capture" src={ocr.image} alt="框选区域" />}
            {ocr.status === "loading" && (
              <div className="selection-loading">
                <span className="spinner" /> 识别中…
              </div>
            )}
            {ocr.status === "error" && (
              <div className="selection-error">识别失败：{ocr.message ?? "未知错误"}</div>
            )}
            {ocr.status === "done" &&
              (ocr.text ? (
                <>
                  <div className="ocr-text">{ocr.text}</div>
                  <div className="ocr-actions">
                    <button className="btn btn-small" onClick={() => void copy()}>
                      {copied ? "已复制" : "复制"}
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => ocr.text && onTranslateSelection(ocr.text)}
                    >
                      翻译
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-hint">未识别到文字，换一个区域再试试</div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}