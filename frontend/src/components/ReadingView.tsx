import { Fragment, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { CONTENT_KINDS } from "../structure";
import type { DocumentStructure, StructuredBlock } from "../structure";
import type { BlockTranslation } from "../types";
import {
  READING_FONT_DEFAULT,
  clampFontSize,
  nextFontSize,
} from "./readingSettings";

const FONT_SIZE_KEY = "scholarust.reading.fontSize";
const SHOW_TRANSLATION_KEY = "scholarust.reading.showTranslation";

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

function readStoredFontSize(): number {
  try {
    const raw = window.localStorage.getItem(FONT_SIZE_KEY);
    if (!raw || !raw.trim()) return READING_FONT_DEFAULT;
    const value = Number(raw);
    return Number.isFinite(value) ? clampFontSize(value) : READING_FONT_DEFAULT;
  } catch {
    return READING_FONT_DEFAULT;
  }
}

function readStoredShowTranslation(): boolean {
  try {
    return window.localStorage.getItem(SHOW_TRANSLATION_KEY) !== "false";
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
  const [fontSize, setFontSize] = useState(readStoredFontSize);
  const [showTranslation, setShowTranslation] = useState(readStoredShowTranslation);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
    } catch {
      /* ignore storage failures */
    }
  }, [fontSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_TRANSLATION_KEY, String(showTranslation));
    } catch {
      /* ignore storage failures */
    }
  }, [showTranslation]);

  useEffect(() => {
    setNoticeDismissed(false);
  }, [structure]);

  const blocks = structure?.blocks ?? [];
  const contentBlocks = blocks.filter((block) => CONTENT_KINDS.includes(block.kind));
  const doneCount = contentBlocks.filter((block) => translations[block.id]?.status === "done").length;
  // An errored or still-loading block is not "done", so the batch button stays
  // alive for a retry instead of claiming everything is translated.
  const allDone = contentBlocks.length > 0 && doneCount === contentBlocks.length;

  const handleTranslateContent = async () => {
    await onTranslateContent();
    setShowTranslation(true);
  };

  const renderStatus = (block: StructuredBlock) => {
    const translation = translations[block.id];
    return (
      <Fragment>
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
            翻译失败：{translation.message ?? "未知错误"}
            <button className="btn btn-small" onClick={() => onTranslateBlock(block)}>
              重试
            </button>
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <div className="reading">
      <div className="reading-toolbar">
        <div className="reading-toolbar-title">{title}</div>
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
            className="btn btn-primary"
            onClick={() => void handleTranslateContent()}
            disabled={batchRunning || allDone || contentBlocks.length === 0}
          >
            {batchRunning ? (
              <>
                <span className="spinner" /> 翻译中 {doneCount}/{contentBlocks.length}
              </>
            ) : allDone ? (
              "正文已全部翻译"
            ) : (
              "翻译正文"
            )}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bilingual-loading">
          <span className="spinner spinner-lg" />
          <div>
            {extractProgress
              ? `正在解析版面… ${extractProgress.done}/${extractProgress.total} 页`
              : "正在解析文档…"}
          </div>
          <button className="btn btn-small" onClick={onCancel}>
            取消解析
          </button>
        </div>
      ) : (
        <>
          {structure?.notice && !noticeDismissed && (
            <div className="reading-notice">
              {structure.notice}
              <button className="btn btn-small" onClick={() => setNoticeDismissed(true)}>
                知道了
              </button>
            </div>
          )}

          <div
            className="reading-article"
            style={{ "--reading-font-size": `${fontSize}px` } as CSSProperties}
          >
            {blocks.length === 0 && (
              <div className="empty-hint">未解析到可阅读的内容块，请回到原文视图查看</div>
            )}

            {blocks.map((block) => {
              if (block.kind === "figure") {
                if (!block.image) return null;
                return (
                  <figure className="reading-figure" key={block.id}>
                    <img src={block.image} alt={block.caption ?? ""} loading="lazy" />
                    {block.caption && <figcaption>{block.caption}</figcaption>}
                  </figure>
                );
              }

              if (block.kind === "title") {
                return (
                  <Fragment key={block.id}>
                    <h1 className="reading-text">{block.text}</h1>
                    {renderStatus(block)}
                  </Fragment>
                );
              }

              if (block.kind === "heading") {
                return (
                  <Fragment key={block.id}>
                    {block.level <= 1 ? (
                      <h2 className="reading-text">{block.text}</h2>
                    ) : (
                      <h3 className="reading-text">{block.text}</h3>
                    )}
                    {renderStatus(block)}
                  </Fragment>
                );
              }

              const className =
                block.kind === "reference"
                  ? "reading-block reading-kind-reference"
                  : `reading-block reading-kind-${block.kind}`;

              return (
                <div className={className} key={block.id}>
                  <p className="reading-text">{block.text}</p>
                  {renderStatus(block)}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
