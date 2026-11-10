import { BLOCK_KIND_LABELS, CONTENT_KINDS } from "../structure";
import type { DocumentStructure, StructuredBlock } from "../structure";
import type { BlockTranslation } from "../types";

interface Props {
  title: string;
  structure: DocumentStructure | null;
  loading: boolean;
  translations: Record<number, BlockTranslation>;
  batchRunning: boolean;
  onTranslateBlock: (block: StructuredBlock) => void;
  onTranslateContent: () => void;
}

export default function ReadingView({
  title,
  structure,
  loading,
  translations,
  batchRunning,
  onTranslateBlock,
  onTranslateContent,
}: Props) {
  if (loading || !structure) {
    return (
      <div className="bilingual-loading">
        <span className="spinner spinner-lg" />
        <div>正在重排文档…</div>
        <div className="muted">过滤页眉、页脚与页码，识别标题、摘要、正文与注释</div>
      </div>
    );
  }

  const contentBlocks = structure.blocks.filter((block) => CONTENT_KINDS.includes(block.kind));
  const doneCount = contentBlocks.filter((block) => translations[block.id]?.status === "done").length;
  const pendingCount = contentBlocks.filter(
    (block) => translations[block.id]?.status !== "done" && translations[block.id]?.status !== "loading",
  ).length;

  return (
    <div className="reading">
      <div className="reading-header">
        <div className="reading-header-text">
          <h2>{title}</h2>
          <div className="reading-stats">
            {structure.blocks.length} 个内容块
            {structure.removedLines > 0 && ` · 已过滤 ${structure.removedLines} 行页眉/页脚/页码`}
            {` · 已译 ${doneCount}/${contentBlocks.length}`}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={onTranslateContent}
          disabled={batchRunning || pendingCount === 0}
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

      {structure.blocks.length === 0 && (
        <div className="empty-hint">未解析到可阅读的内容块，请回到原文视图查看</div>
      )}

      {structure.blocks.map((block) => {
        const translation = translations[block.id];
        return (
          <section key={block.id} className={`reading-block reading-kind-${block.kind}`}>
            <div className="reading-block-meta">
              <span className={`block-kind block-kind-${block.kind}`}>
                {BLOCK_KIND_LABELS[block.kind]}
                {block.kind === "heading" && block.level > 0 ? ` H${block.level}` : ""}
              </span>
              {block.page != null && <span className="block-page">第 {block.page} 页</span>}
            </div>
            <div className="reading-block-text">{block.text}</div>
            {translation?.status === "loading" && (
              <div className="reading-translating">
                <span className="spinner" /> 正在翻译…
              </div>
            )}
            {translation?.status === "error" && (
              <div className="reading-error">翻译失败：{translation.message ?? "未知错误"}</div>
            )}
            {translation?.status === "done" && translation.result && (
              <div className="reading-translated">{translation.result.result}</div>
            )}
            <div className="reading-block-actions">
              <button
                className="btn btn-small"
                onClick={() => onTranslateBlock(block)}
                disabled={translation?.status === "loading" || batchRunning}
              >
                {translation?.status === "done"
                  ? "重新翻译"
                  : translation?.status === "error"
                    ? "重试"
                    : "翻译此块"}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}