import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { CONTENT_KINDS } from "../structure";
import type { DocumentStructure, StructuredBlock } from "../structure";
import type { BlockTranslation } from "../types";
import {
  clampFontSize,
  nextFontSize,
  READING_FONT_DEFAULT,
} from "./readingSettings";

interface Props {
  title: string;
  structure: DocumentStructure | null;
  loading: boolean;
  extractProgress: { done: number; total: number } | null;
  translations: Record<number, BlockTranslation>;
  batchRunning: boolean;
  onTranslateBlock: (block: StructuredBlock) => void;
  onTranslateContent: () => Promise<void>;
  onCancel: () => void;
}

function initialFontSize(): number {
  try {
    const raw = localStorage.getItem("scholarust.reading.fontSize");
    const value = raw == null ? NaN : Number(raw);
    return Number.isFinite(value) ? clampFontSize(value) : READING_FONT_DEFAULT;
  } catch {
    return READING_FONT_DEFAULT;
  }
}

function initialShowTranslation(): boolean {
  try {
    return localStorage.getItem("scholarust.reading.showTranslation") !== "false";
  } catch {
    return true;
  }
}

export default function ReadingView({
  title,
  structure,
  loading,
  extractProgress,
  translations,
  batchRunning,
  onTranslateBlock,
  onTranslateContent,
  onCancel,
}: Props) {
  const [fontSize, setFontSize] = useState(initialFontSize);
  const [showTranslation, setShowTranslation] = useState(initialShowTranslation);
  const [noticeOpen, setNoticeOpen] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem("scholarust.reading.fontSize", String(fontSize));
    } catch {
      /* storage unavailable */
    }
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem("scholarust.reading.showTranslation", String(showTranslation));
    } catch {
      /* storage unavailable */
    }
  }, [showTranslation]);

  useEffect(() => {
    setNoticeOpen(true);
  }, [structure]);

  const contentBlocks =
    structure?.blocks.filter((block) => CONTENT_KINDS.includes(block.kind)) ?? [];
  const doneCount = contentBlocks.filter((block) => translations[block.id]?.status === "done").length;
  const pendingCount = contentBlocks.filter(
    (block) => translations[block.id]?.status !== "done" && translations[block.id]?.status !== "loading",
  ).length;

  const blockButton = (block: StructuredBlock) =>
    CONTENT_KINDS.includes(block.kind) && translations[block.id]?.status !== "loading" ? (
      <button
        className="block-translate-btn"
        title="翻译这一段"
        onClick={() => onTranslateBlock(block)}
      >
        译
      </button>
    ) : null;

  const translationFor = (block: StructuredBlock) => {
    const translation = translations[block.id];
    return (
      <>
        {showTranslation && translation?.status === "done" && translation.result && (
          <div className="reading-translation">{translation.result.result}</div>
        )}
        {translation?.status === "loading" && (
          <div className="reading-translating">
            <span className="spinner" /> 正在翻译…
          </div>
        )}
        {translation?.status === "error" && (
          <div className="reading-error">
            翻译失败：{translation.message ?? "未知错误"}{" "}
            <button className="btn-link" onClick={() => onTranslateBlock(block)}>
              重试
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="reading">
      <div className="reading-toolbar">
        <div className="reading-toolbar-title" title={title}>
          {title}
        </div>
        <div className="reading-toolbar-actions">
          <button
            className="btn btn-small"
            onClick={() => setFontSize((size) => nextFontSize(size, -1))}
            title="减小字号"
          >
            A-
          </button>
          <span className="reading-font-label">{fontSize}</span>
          <button
            className="btn btn-small"
            onClick={() => setFontSize((size) => nextFontSize(size, 1))}
            title="增大字号"
          >
            A+
          </button>
          <label className="reading-toggle">
            <input
              type="checkbox"
              checked={showTranslation}
              onChange={(event) => setShowTranslation(event.target.checked)}
            />
            译文
          </label>
          <button
            className="btn btn-primary btn-small"
            onClick={() => {
              void (async () => {
                await onTranslateContent();
                setShowTranslation(true);
              })();
            }}
            disabled={batchRunning || pendingCount === 0 || loading || !structure}
            title="只翻译标题、章节、摘要、正文与注释，不含参考文献与图表说明"
          >
            {batchRunning ? (
              <>
                <span className="spinner" /> 翻译中 {doneCount}/{contentBlocks.length}
              </>
            ) : pendingCount === 0 && contentBlocks.length > 0 ? (
              "正文已全部翻译"
            ) : (
              "翻译正文"
            )}
          </button>
        </div>
      </div>

      {loading || !structure ? (
        <div className="bilingual-loading">
          <span className="spinner spinner-lg" />
          <div>
            {extractProgress
              ? `正在识别版面… ${extractProgress.done}/${extractProgress.total} 页`
              : "正在解析文档…"}
          </div>
          <button className="btn btn-small" onClick={onCancel}>
            取消解析
          </button>
        </div>
      ) : (
        <>
          {structure.notice && noticeOpen && (
            <div className="reading-notice">
              {structure.notice}{" "}
              <button className="btn-link" onClick={() => setNoticeOpen(false)}>
                关闭
              </button>
            </div>
          )}
          {structure.blocks.length === 0 ? (
            <div className="empty-hint">没有可阅读的文本（可能是扫描版 PDF）。</div>
          ) : (
            <article
              className="reading-article"
              style={{ "--reading-font-size": `${fontSize}px` } as CSSProperties}
            >
              {structure.blocks.map((block) => {
                if (block.kind === "figure") {
                  if (!block.image) return null;
                  return (
                    <figure key={block.id} className="reading-figure">
                      <img src={block.image} alt={block.caption ?? ""} loading="lazy" />
                      {block.caption && <figcaption>{block.caption}</figcaption>}
                    </figure>
                  );
                }
                if (block.kind === "title") {
                  return (
                    <div key={block.id} className="reading-translatable">
                      {blockButton(block)}
                      <h1 className="reading-text">{block.text}</h1>
                      {translationFor(block)}
                    </div>
                  );
                }
                if (block.kind === "heading") {
                  return (
                    <div key={block.id} className="reading-translatable">
                      {blockButton(block)}
                      {block.level <= 1 ? (
                        <h2 className="reading-text">{block.text}</h2>
                      ) : (
                        <h3 className="reading-text">{block.text}</h3>
                      )}
                      {translationFor(block)}
                    </div>
                  );
                }
                return (
                  <div
                    key={block.id}
                    className={`reading-block reading-translatable reading-kind-${block.kind}`}
                  >
                    {blockButton(block)}
                    <p className="reading-text">{block.text}</p>
                    {translationFor(block)}
                  </div>
                );
              })}
            </article>
          )}
        </>
      )}
    </div>
  );
}