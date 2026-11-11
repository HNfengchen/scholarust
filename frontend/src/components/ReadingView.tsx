import { memo, useEffect, useMemo, useState } from "react";
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
  onCancelBatch: () => void;
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

const ReadingBlock = memo(function ReadingBlock({ block, translation, showTranslation, onTranslate }: {
  block: StructuredBlock;
  translation?: BlockTranslation;
  showTranslation: boolean;
  onTranslate: (block: StructuredBlock) => void;
}) {
  if (block.kind === "figure") {
    if (block.html) return <div className="reading-figure reading-rich" data-block-id={block.id} dangerouslySetInnerHTML={{ __html: block.html }} />;
    return block.image ? (
      <figure className="reading-figure" data-block-id={block.id}>
        <img src={block.image} alt={block.caption ?? "文档图表"} loading="lazy" decoding="async" />
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    ) : null;
  }
  const content = block.html ? (
    <div className="reading-text reading-rich" dangerouslySetInnerHTML={{ __html: block.html }} />
  ) : block.kind === "title" ? (
    <h1 className="reading-text">{block.text}</h1>
  ) : block.kind === "heading" ? (
    block.level <= 1 ? <h2 className="reading-text">{block.text}</h2> : <h3 className="reading-text">{block.text}</h3>
  ) : <p className="reading-text">{block.text}</p>;
  return (
    <div className={`reading-block reading-translatable reading-kind-${block.kind}`} data-block-id={block.id}>
      {CONTENT_KINDS.includes(block.kind) && translation?.status !== "loading" && (
        <button className="block-translate-btn" title="翻译这一段" onClick={() => onTranslate(block)}>译</button>
      )}
      {content}
      {showTranslation && translation?.status === "done" && translation.result && (
        <div className="reading-translation">{translation.result.result}</div>
      )}
      {translation?.status === "loading" && (
        <div className="reading-translating"><span className="spinner" /> 正在翻译…</div>
      )}
      {translation?.status === "error" && (
        <div className="reading-error">
          翻译失败：{translation.message ?? "未知错误"}
          <button className="btn btn-small" onClick={() => onTranslate(block)}>重试</button>
        </div>
      )}
    </div>
  );
});

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
  onCancelBatch,
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

  const blocks = useMemo(() => structure?.blocks ?? [], [structure]);
  const contentBlocks = useMemo(() => blocks.filter((block) => CONTENT_KINDS.includes(block.kind)), [blocks]);
  const doneCount = contentBlocks.filter((block) => translations[block.id]?.status === "done").length;
  // An errored or still-loading block is not "done", so the batch button stays
  // alive for a retry instead of claiming everything is translated.
  const allDone = contentBlocks.length > 0 && doneCount === contentBlocks.length;

  const handleTranslateContent = async () => {
    await onTranslateContent();
    setShowTranslation(true);
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
          {batchRunning && (
            <button
              className="btn btn-small btn-danger"
              onClick={onCancelBatch}
              title="停止批量翻译，已完成的译文会保留"
            >
              取消
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bilingual-loading">
          <span className="spinner spinner-lg" />
          <div>
            {extractProgress
              ? `正在解析文档… ${extractProgress.done}/${extractProgress.total}`
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

            {blocks.map((block) => (
              <ReadingBlock
                key={block.id}
                block={block}
                translation={translations[block.id]}
                showTranslation={showTranslation}
                onTranslate={onTranslateBlock}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
