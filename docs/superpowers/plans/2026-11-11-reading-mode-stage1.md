# 阅读模式重做 Stage 1（Scholaread 风格 + 无损抽取）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把阅读模式改成连续单栏文章排版，并把 PDF 抽取换成"文本层坐标 + XY-cut + 悬挂缩进"的无损管线：内容不丢、双栏顺序正确、参考文献逐条排序、嵌入位图保留原位置。

**Architecture:** 纯前端。pdf.js 的 `getTextContent()` 给出每个文字 item 的坐标 → 行聚合 → XY-cut 排序（含通栏元素）→ 段落合并与标题识别 → 参考文献逐条成块并按编号排序。图片用 `getOperatorList()` 的 CTM 定位嵌入位图并裁成 data URL，与文字一起参与同一遍排序。阅读界面重写为文章排版，译文内联在段落下。

**Tech Stack:** Tauri 2, React 18, TypeScript, pdfjs-dist 4.8, Vitest 3, Rust base64.

**Spec:** `docs/superpowers/specs/2026-11-11-reading-mode-stage1-design.md`（Stage 2 模型部分见 `docs/superpowers/specs/2026-11-11-layout-model-stage-design.md`，**不在本计划内**）

## Global Constraints

- **抽取零丢失**：PDF 文本层的每个非空 text item 必须落到某个块；任何情况下不得整段丢弃。
- **页眉页脚剔除必须三重条件**：位于页面顶部 6% 或底部 6% 区域、且在 ≥40% 页面重复出现、且是纯页码样式或等于文档标题。宁可留错不可丢字。
- **参考文献**：条目按 `^\s*(\[\d+\]|\d+[.)]|\(\d+\))` 或悬挂缩进（比节内正文左边界小 > 0.5×bodySize）切分；按首个编号数字升序排序。
- **双栏顺序**：先左栏后右栏；横跨栏间空隙的行（通栏标题/大图）必须排在该层最前。
- `block.id` 保持 `number`，从 1 连续递增（阅读顺序）；翻译缓存键不变。
- 字体范围 14–24px，默认 17px；localStorage 键 `scholarust.reading.fontSize`、`scholarust.reading.showTranslation`。
- 图片最长边统一 1600px，JPEG 0.92；所有进缓存的图片必须是 data URL（禁止 blob URL）。
- 不引入 `onnxruntime-web` / `vite-plugin-static-copy` / Rust `ort`（Stage 2 才做）。
- TypeScript 严格模式（`noUnusedLocals`/`noUnusedParameters`）；每次改动后 `npm --prefix frontend run build` 必须通过。
- 不改 `extractPdfStructure` 的现有启发式行为（大纲面板的回退来源依赖它）。
- 不改翻译服务；不改原始阅读器视图。

## Review Focus

- **漏字**：任一页正文整段丢失是最严重的失败。验证：Task 4/6 单测 + Task 12 逐页与原文比对。
- **双栏串行**：两栏正文混排或通栏标题掉到最后一栏。验证：Task 5 单测（双栏、通栏标题）+ Task 12 手动。
- **参考文献乱序/粘连**：20 条以上文献必须逐条显示且编号有序。验证：Task 7 单测。
- **越权读文件**：Markdown 相对图片路径 `../../secret.png` 必须被拒绝。验证：Task 1 已有单测 + Task 11 手动。
- **静默丢图**：矢量图/表格抽不出来时必须给出 `notice` 提示，不能悄悄消失。验证：Task 8/9 单测 + Task 12 手动。

---

### Task 0: 基线提交

**Files:** 现有仓库全部文件

- [ ] **Step 1: 建立基线提交**

```bash
git add .gitignore README.md Cargo.toml package.json package-lock.json app crates frontend examples plugins scholarust.bat docs
git commit -m "chore: baseline before reading mode redesign"
```

预期：`git log --oneline` 出现一条基线提交，之后每个任务都能用 `git diff` 审查。

---

### Task 1: Rust 模型路径与文档图片命令

**Files:**
- Modify: `app/Cargo.toml`
- Modify: `app/src/model.rs`
- Modify: `app/src/commands.rs`
- Modify: `app/src/lib.rs`
- Modify: `README.md`

**Interfaces:**
- Produces: `ModelManager::layout_model_path(&self) -> PathBuf`
- Produces: `#[tauri::command] layout_model_info(app, state) -> Result<LayoutModelInfo, String>` → `{ path: string, exists: boolean }`
- Produces: `#[tauri::command] read_document_image(state, id: String, src: String) -> Result<String, String>` → data URL
- Produces: `fn resolve_document_image_path(base: &Path, src: &str) -> Result<PathBuf, String>`

- [ ] **Step 1: 写失败的路径安全测试**（`app/src/commands.rs` 末尾）

```rust
#[cfg(test)]
mod tests {
    use super::resolve_document_image_path;

    #[test]
    fn resolve_document_image_path_accepts_child() {
        let root = std::env::temp_dir().join("scholarust-img-ok");
        let doc_dir = root.join("doc");
        std::fs::create_dir_all(&doc_dir).unwrap();
        std::fs::write(doc_dir.join("fig.png"), b"x").unwrap();
        let path = resolve_document_image_path(&doc_dir, "fig.png").unwrap();
        assert_eq!(path.file_name().unwrap(), "fig.png");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_document_image_path_rejects_escape() {
        let root = std::env::temp_dir().join("scholarust-img-escape");
        let doc_dir = root.join("doc");
        std::fs::create_dir_all(&doc_dir).unwrap();
        std::fs::write(root.join("secret.png"), b"x").unwrap();
        let err = resolve_document_image_path(&doc_dir, "../secret.png").unwrap_err();
        assert!(err.contains("escapes"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p scholarust resolve_document_image_path`
Expected: 编译失败，`resolve_document_image_path` 未定义。

- [ ] **Step 3: 实现 helper 与命令**

`app/Cargo.toml` 增加 `base64 = "0.22"`。`commands.rs` 增加：

```rust
pub fn resolve_document_image_path(base: &Path, src: &str) -> Result<std::path::PathBuf, String> {
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    let path = base.join(src).canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&base) {
        return Err("image path escapes document directory".into());
    }
    Ok(path)
}
```

`read_document_image`：取 `doc.path` 的父目录 → helper → 按扩展名映射 mime（png/jpg/jpeg/gif/webp/svg/bmp）→ `base64::engine::general_purpose::STANDARD.encode(bytes)` → data URL。取路径时立刻释放库锁，IO 不在锁内。

`layout_model_info`：`state.model.layout_model_path()`，存在时 `app.asset_protocol_scope().allow_file(&path)`。

`model.rs` 增加：

```rust
pub fn layout_model_path(&self) -> PathBuf {
    self.models_dir.join("layout").join("doclayout_yolo_docstructbench_imgsz1024.onnx")
}
```

`lib.rs` 的 `generate_handler!` 增加 `commands::layout_model_info`、`commands::read_document_image`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test -p scholarust resolve_document_image_path`
Expected: 2 passed。

Run: `cargo check -p scholarust`
Expected: 成功。

- [ ] **Step 5: README 增加模型下载说明**（Stage 2 用）

在 Hy-MT2 小节后加：

```markdown
## 版面模型（Stage 2，可选）

PDF 阅读模式的无损抽取不依赖模型。若要启用实验性的版面识别（矢量图/表格裁剪），手动放置：

```bash
mkdir -p models/layout
curl -L -o models/layout/doclayout_yolo_docstructbench_imgsz1024.onnx \
  https://hf-mirror.com/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx
```
```

- [ ] **Step 6: 提交**

```bash
git add app/Cargo.toml app/src/model.rs app/src/commands.rs app/src/lib.rs README.md
git commit -m "feat: add layout model and document image commands"
```

---

### Task 2: 阅读结构类型扩展

**Files:**
- Modify: `frontend/src/structure.ts`（类型区，约 4–40 行）

**Interfaces:**
- Produces: `BlockKind` 增加 `"figure"` 与 `"reference"`
- Produces: `StructuredBlock` 增加 `image?: string`、`caption?: string`
- Produces: `DocumentStructure` 增加 `notice?: string`
- Produces: `export type ReadingStructureExtractor = (onProgress?: (done: number, total: number) => void) => Promise<DocumentStructure>`
- Produces: `export function sectionForHeading(text: string): Section | null`（给现有函数加 `export`）
- Produces: `export type Section`（若当前未导出则导出）

- [ ] **Step 1: 修改类型**

`BlockKind` 加 `| "figure" | "reference"`；`StructuredBlock` 加 `image?: string; caption?: string;`；`DocumentStructure` 加 `notice?: string;`；新增 `ReadingStructureExtractor`；`BLOCK_KIND_LABELS` 加 `figure: "图片"`、`reference: "参考文献"`；`sectionForHeading` 与 `Section` 加 `export`。`CONTENT_KINDS` 保持不变（`figure` 不翻译；`reference` 要翻译则加入 `CONTENT_KINDS`——**加入 `reference`**，参考文献条目需要译文）。

- [ ] **Step 2: 验证构建**

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/structure.ts
git commit -m "feat: add figure and reference block kinds"
```

---

### Task 3: 阅读界面重写

**Files:**
- Modify: `frontend/package.json`（`vitest` devDependency、`test` script）
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/components/readingSettings.ts`
- Create: `frontend/src/components/readingSettings.test.ts`
- Modify: `frontend/src/components/ReadingView.tsx`（整体替换）
- Modify: `frontend/src/styles.css`（阅读样式段，约 1237–1391 行）
- Modify: `frontend/src/App.tsx`（ReadingView 调用处）

**Interfaces:**
- Produces: `clampFontSize(value: number): number`、`nextFontSize(current: number, delta: number): number`、`READING_FONT_MIN = 14`、`READING_FONT_MAX = 24`、`READING_FONT_DEFAULT = 17`
- Produces: `ReadingView` props：

```ts
interface Props {
  title: string;
  structure: DocumentStructure | null;
  loading: boolean;
  extractProgress: { done: number; total: number } | null;
  translations: Record<number, BlockTranslation>;
  batchRunning: boolean;
  onTranslateBlock: (block: StructuredBlock) => void;
  onTranslateContent: () => Promise<void>;
}
```

- [ ] **Step 1: 安装 Vitest 并写字体设置的失败测试**

```bash
npm --prefix frontend install -D vitest@^3.0.0
```

`frontend/package.json` scripts 加 `"test": "vitest run"`。`frontend/vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

`readingSettings.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { clampFontSize, nextFontSize } from "./readingSettings";

describe("reading font size", () => {
  it("clamps to 14..24", () => {
    expect(clampFontSize(10)).toBe(14);
    expect(clampFontSize(30)).toBe(24);
    expect(clampFontSize(17)).toBe(17);
  });
  it("steps without leaving the range", () => {
    expect(nextFontSize(17, 1)).toBe(18);
    expect(nextFontSize(24, 1)).toBe(24);
    expect(nextFontSize(14, -1)).toBe(14);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- readingSettings`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `readingSettings.ts`**

```ts
export const READING_FONT_MIN = 14;
export const READING_FONT_MAX = 24;
export const READING_FONT_DEFAULT = 17;

export function clampFontSize(value: number): number {
  return Math.min(READING_FONT_MAX, Math.max(READING_FONT_MIN, Math.round(value)));
}

export function nextFontSize(current: number, delta: number): number {
  return clampFontSize(current + delta);
}
```

- [ ] **Step 4: 重写 `ReadingView.tsx`**

规则：
- 根节点 `.reading`；顶部 `.reading-toolbar`（sticky）：`title`、A-/A+、当前字号、`译文` checkbox、`翻译正文` 按钮。
- 正文 `.reading-article`，`style={{ "--reading-font-size": `${fontSize}px` } as CSSProperties}`。
- `fontSize` 初值读 `localStorage["scholarust.reading.fontSize"]`，非法则用 17；变化时写回。
- `showTranslation` 初值 `localStorage["scholarust.reading.showTranslation"] !== "false"`；变化时写回。
- `loading` 时显示 spinner；有 `extractProgress` 显示 `正在解析… ${done}/${total} 页`，否则 `正在解析文档…`。
- `structure.notice` 显示可关闭的 `.reading-notice`。
- 遍历 `structure.blocks`：
  - `title` → `<h1 className="reading-text">`
  - `heading` → `level <= 1 ? h2 : h3`，`className="reading-text"`
  - `figure` → 有 `image` 时 `<figure className="reading-figure"><img src={image} alt={caption ?? ""} loading="lazy" />{caption && <figcaption>…</figcaption>}</figure>`；无图跳过
  - `reference` → `<div className="reading-block reading-kind-reference"><p className="reading-text">…`
  - 其他 → `<div className={`reading-block reading-kind-${kind}`}><p className="reading-text">…`
- 每个非 figure 块之后渲染译文（`showTranslation && translations[block.id]?.status === "done"`）：`.reading-translation`。
- 翻译中显示 `.reading-translating`；失败显示 `.reading-error` + 文字按钮"重试"，调用 `onTranslateBlock(block)`。
- `翻译正文` 按钮：`batchRunning` 显示 `翻译中 done/total`；没有待翻译项时显示 `正文已全部翻译` 并禁用；点击 `await onTranslateContent(); setShowTranslation(true);`。
- 删除 `BLOCK_KIND_LABELS`、页码、kind 标签、每块翻译按钮。

- [ ] **Step 5: 替换阅读样式**

删除旧卡片式阅读样式（保留 `.btn-small`、`.btn-danger`），新增：

```css
.reading { max-width: 820px; margin: 0 auto; padding: 0 32px 96px; }
.reading-toolbar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 0 -32px 28px; padding: 12px 32px; background: rgba(245, 246, 248, 0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
.reading-toolbar-title { min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reading-toolbar-actions { display: flex; align-items: center; gap: 8px; }
.reading-font-label { min-width: 28px; text-align: center; color: var(--muted); font-size: 12px; }
.reading-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); }
.reading-article { max-width: 46rem; margin: 0 auto; font-size: var(--reading-font-size, 17px); line-height: 1.85; }
.reading-article h1 { margin: 0 0 0.9em; font-size: 1.9em; line-height: 1.35; }
.reading-article h2 { margin: 1.8em 0 0.6em; font-size: 1.35em; line-height: 1.45; }
.reading-article h3 { margin: 1.5em 0 0.5em; font-size: 1.12em; line-height: 1.5; }
.reading-block { margin: 0 0 1.35em; }
.reading-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
.reading-kind-note .reading-text, .reading-kind-references .reading-text, .reading-kind-meta .reading-text, .reading-kind-caption .reading-text { font-size: 0.86em; color: var(--muted); }
.reading-kind-reference .reading-text { font-size: 0.86em; color: var(--muted); }
.reading-kind-caption .reading-text { text-align: center; }
.reading-translation { margin-top: 0.45em; padding-left: 0.8em; border-left: 1px solid var(--border); color: var(--muted); font-size: 0.95em; line-height: 1.8; white-space: pre-wrap; word-break: break-word; }
.reading-translating { margin-top: 0.35em; color: var(--faint); font-size: 0.78em; }
.reading-error { margin-top: 0.35em; color: var(--danger); font-size: 0.82em; }
.reading-figure { margin: 1.8em 0; text-align: center; }
.reading-figure img { max-width: 100%; height: auto; border-radius: 4px; }
.reading-figure figcaption { margin-top: 0.5em; color: var(--muted); font-size: 0.82em; line-height: 1.6; }
.reading-notice { margin: 0 auto 20px; max-width: 46rem; padding: 10px 14px; border: 1px solid #fde68a; background: #fffbeb; color: #92400e; border-radius: 8px; font-size: 13px; }
.empty-hint { color: var(--muted); text-align: center; padding: 48px 0; }
```

- [ ] **Step 6: 更新 App 的 ReadingView 调用**

传 `extractProgress={null}`（Task 9 接真实状态）、`onTranslateContent={() => translateContent()}`；保留 `onTranslateBlock`。

- [ ] **Step 7: 运行测试和构建**

Run: `npm --prefix frontend run test -- readingSettings`
Expected: 2 passed。

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 8: 提交**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/components/ReadingView.tsx frontend/src/components/readingSettings.ts frontend/src/components/readingSettings.test.ts frontend/src/styles.css frontend/src/App.tsx
git commit -m "feat: reflow reading view as continuous article"
```

---

### Task 4: 文本层坐标与行聚合

**Files:**
- Create: `frontend/src/layout/types.ts`
- Create: `frontend/src/layout/pdfText.ts`
- Create: `frontend/src/layout/pdfText.test.ts`

**Interfaces:**
- Produces: `LayoutRect { x: number; y: number; w: number; h: number }`
- Produces: `PdfTextItem { x: number; baseline: number; width: number; size: number; str: string }`
- Produces: `TextLine { x: number; baseline: number; width: number; size: number; text: string }`
- Produces: `itemsFromTextContent(items: PdfJsTextItem[], pageHeight: number): PdfTextItem[]`
- Produces: `groupItemsIntoLines(items: PdfTextItem[]): TextLine[]`

- [ ] **Step 1: 写失败测试**

`pdfText.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { groupItemsIntoLines, itemsFromTextContent } from "./pdfText";

const raw = (str: string, x: number, baseline: number, width: number, size = 10) => ({
  str, width, height: size, transform: [1, 0, 0, size, x, baseline], dir: "ltr", fontName: "F", hasEOL: false,
});

describe("itemsFromTextContent", () => {
  it("flips the PDF origin to page coordinates and drops empty items", () => {
    const items = itemsFromTextContent(
      [raw("Hello", 40, 700, 30), raw("", 10, 700, 5), raw("World", 80, 700, 30)],
      792,
    );
    expect(items).toHaveLength(2);
    expect(items[0].x).toBe(40);
    expect(items[0].baseline).toBe(92);
    expect(items[0].size).toBe(10);
  });
});

describe("groupItemsIntoLines", () => {
  it("merges items on the same baseline left to right", () => {
    const lines = groupItemsIntoLines([
      { x: 50, baseline: 100, width: 30, size: 10, str: "world" },
      { x: 10, baseline: 100, width: 30, size: 10, str: "hello" },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("hello world");
    expect(lines[0].x).toBe(10);
    expect(lines[0].width).toBe(70);
  });

  it("keeps different baselines apart", () => {
    const lines = groupItemsIntoLines([
      { x: 10, baseline: 100, width: 30, size: 10, str: "one" },
      { x: 10, baseline: 120, width: 30, size: 10, str: "two" },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- pdfText.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `types.ts` 与 `pdfText.ts`**

- `itemsFromTextContent`：跳过 `str` 为空的 item；`x = transform[4]`；`baseline = pageHeight - transform[5]`；`size = Math.abs(transform[3]) || item.height`；`width = item.width`。
- `groupItemsIntoLines`：按 `baseline` 升序；当前行与新 item 的基线差 > `max(1, 当前行 size * 0.35)` 时开新行；行内按 `x` 排序；相邻 item 间隙 `next.x - (prev.x + prev.width) > 0.25 * size` 时补空格，否则直接拼接；行 `x` 取最小、`width` 取最右边界 - 最左边界、`size` 取行内最大、`baseline` 取行内平均。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix frontend run test -- pdfText.test`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/layout/types.ts frontend/src/layout/pdfText.ts frontend/src/layout/pdfText.test.ts
git commit -m "feat: extract pdf text items and group them into lines"
```

---

### Task 5: 双栏检测与阅读顺序

**Files:**
- Create: `frontend/src/layout/order.ts`
- Create: `frontend/src/layout/order.test.ts`

**Interfaces:**
- Consumes: `frontend/src/layout/pdfText.ts` 的 `PdfTextItem`、`TextLine`、`groupItemsIntoLines`
- Produces: `GutterResult { gutter: [number, number] | null; spanning: Set<number> }`
- Produces: `detectGutter(items: PdfTextItem[], pageWidth: number, pageHeight: number, bodySize?: number): GutterResult`
- Produces: `orderPageLines(items: PdfTextItem[], pageWidth: number, pageHeight: number, bodySize?: number): TextLine[]`
- 约定：`PdfTextItem.x` 是左边距，`baseline` 是基线（页面坐标，从页面顶部算），`width` 是宽度。

- [ ] **Step 1: 写失败测试**

`order.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { detectGutter, orderPageLines } from "./order";
import type { PdfTextItem } from "./pdfText";

const item = (x: number, baseline: number, width: number, size = 10, str = "x"): PdfTextItem => ({
  x, baseline, width, size, str,
});
const column = (x: number, baselines: number[]) => baselines.map((b) => item(x, b, 140));

describe("detectGutter", () => {
  it("finds the gutter between two columns", () => {
    const items = [...column(10, [100, 120, 140, 160]), ...column(250, [100, 120, 140, 160])];
    const result = detectGutter(items, 400, 500, 10);
    expect(result.gutter).not.toBeNull();
    expect(result.gutter![0]).toBe(150);
    expect(result.gutter![1]).toBe(250);
  });

  it("does not mistake word spacing for a gutter", () => {
    const items = [item(10, 100, 30), item(43, 100, 30), item(76, 100, 30)];
    expect(detectGutter(items, 400, 500, 10).gutter).toBeNull();
  });

  it("marks a centred title as spanning instead of blocking the gutter", () => {
    const items = [
      ...column(10, [100, 120, 140, 160]),
      ...column(250, [100, 120, 140, 160]),
      item(170, 60, 60, 14, "Title"),
    ];
    const result = detectGutter(items, 400, 500, 10);
    expect(result.gutter).not.toBeNull();
    expect(result.spanning.size).toBe(1);
  });
});

describe("orderPageLines", () => {
  it("reads the left column before the right column", () => {
    const items = [...column(10, [100, 120]), ...column(250, [100, 120])];
    const lines = orderPageLines(items, 400, 500, 10);
    expect(lines.map((l) => l.x)).toEqual([10, 10, 250, 250]);
  });

  it("puts a spanning title first", () => {
    const items = [
      ...column(10, [100, 120]),
      ...column(250, [100, 120]),
      item(170, 60, 60, 14, "Title"),
    ];
    const lines = orderPageLines(items, 400, 500, 10);
    expect(lines[0].text).toBe("Title");
    expect(lines.map((l) => l.x)).toEqual([170, 10, 10, 250, 250]);
  });

  it("sorts a single column by baseline", () => {
    const items = [item(10, 200, 300), item(10, 100, 300)];
    const lines = orderPageLines(items, 400, 500, 10);
    expect(lines.map((l) => l.baseline)).toEqual([100, 200]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- order.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `order.ts`**

`detectGutter(items, pageWidth, pageHeight, bodySize)`：

1. `bodySize` 缺省取所有 item `size` 的中位数（四舍五入到 0.5）。
2. 正文带 = `baseline` 落在 `[0.08 * pageHeight, 0.92 * pageHeight]` 的 item；其余忽略。
3. **覆盖直方图**：以 1pt 为一格覆盖 `[0, pageWidth]`，每个正文 item 给 `[x, x + width]` 区间内的格子加 1。
4. `maxCoverage` = 最大格值；`lowThreshold = max(1, floor(0.15 * maxCoverage))`（标题等少数 item 横跨栏缝时仍能把栏缝识别出来）。
5. 在**最左与最右被覆盖格之间**找连续的低覆盖段（每格 ≤ `lowThreshold`）；取最宽的一段，其宽度需 ≥ `minGap = max(0.02 * pageWidth, 1.2 * bodySize)`（栏缝通常只有页宽的 2–4%，用页宽比例做阈值会漏判）。
6. 命中：栏缝为 `[g0, g1]`；`spanning` = 满足 `x < g1 && x + width > g0` 的 item 集合；否则 `gutter = null`、`spanning` 为空集。

`orderPageLines(items, pageWidth, pageHeight, bodySize)`：

1. 单栏（`gutter === null`）：全部 item 用 `groupItemsIntoLines` 聚成行，按 `(baseline, x)` 排序。
2. 双栏：左栏 item = `x + width <= g0`；右栏 item = `x >= g1`；其余为通栏 item。三组各自 `groupItemsIntoLines`。
3. 输出 = **通栏行与左栏行按 `baseline` 归并**（页首标题因此排在最前），**再整体接上右栏行**。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix frontend run test -- order.test`
Expected: 6 passed。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/layout/order.ts frontend/src/layout/order.test.ts
git commit -m "feat: detect two column gutter and order page lines"
```

---

### Task 6: 段落合并与标题识别

**Files:**
- Create: `frontend/src/layout/paragraphs.ts`
- Create: `frontend/src/layout/paragraphs.test.ts`

**Interfaces:**
- Produces: `bodySizeOf(lines: TextLine[]): number`
- Produces: `headingLevelForLine(line: TextLine, bodySize: number): number | null`
- Produces: `mergeLinesIntoParagraphs(lines: TextLine[], bodySize: number): TextLine[][]`
- Produces: `isListItem(line: TextLine): boolean`

- [ ] **Step 1: 写失败测试**

`paragraphs.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { bodySizeOf, headingLevelForLine, mergeLinesIntoParagraphs } from "./paragraphs";

const line = (baseline: number, text: string, x = 0, size = 10): TextLine => ({
  x, baseline, width: text.length * size * 0.5, size, text,
});

describe("bodySizeOf", () => {
  it("uses the most common size weighted by characters", () => {
    const lines = [line(0, "aaaa", 0, 10), line(20, "bb", 0, 12), line(40, "cccc", 0, 10)];
    expect(bodySizeOf(lines)).toBe(10);
  });
});

describe("headingLevelForLine", () => {
  it("grades by relative size", () => {
    expect(headingLevelForLine(line(0, "Title", 0, 17), 10)).toBe(1);
    expect(headingLevelForLine(line(0, "Section", 0, 13), 10)).toBe(2);
    expect(headingLevelForLine(line(0, "Sub", 0, 11), 10)).toBe(3);
    expect(headingLevelForLine(line(0, "Body text", 0, 10), 10)).toBeNull();
  });
  it("detects numbered headings", () => {
    expect(headingLevelForLine(line(0, "2.1 Related work", 0, 10), 10)).toBe(2);
    expect(headingLevelForLine(line(0, "Introduction", 0, 10), 10)).toBeNull();
  });
});

describe("mergeLinesIntoParagraphs", () => {
  it("splits when the line gap is large", () => {
    const groups = mergeLinesIntoParagraphs([line(0, "one"), line(12, "two"), line(60, "three")], 10);
    expect(groups.map((g) => g.map((l) => l.text).join(" "))).toEqual(["one two", "three"]);
  });

  it("splits an indented line after terminal punctuation", () => {
    const groups = mergeLinesIntoParagraphs([line(0, "one."), line(12, "two", 24)], 10);
    expect(groups.map((g) => g.map((l) => l.text).join(" "))).toEqual(["one.", "two"]);
  });

  it("joins hyphenated line breaks", () => {
    const groups = mergeLinesIntoParagraphs([line(0, "inter-"), line(12, "national")], 10);
    expect(groups.map((g) => g.map((l) => l.text).join(" "))).toEqual(["international"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- paragraphs.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `paragraphs.ts`**

- `bodySizeOf`：按 `size` 四舍五入到 0.5 分桶，字符数加权，取权重最大的桶的值。
- `headingLevelForLine`：
  - 编号模式 `^(\d+(?:\.\d+)*)[.、\s]` → 层级 = 点数（`2.` → 1，`2.1` → 2），且整行长度 < 120；
  - `size >= bodySize * 1.6` → 1；`>= 1.25` → 2；`>= 1.1` 且文本长度 < 90 → 3；
  - 否则 `null`。
- `mergeLinesIntoParagraphs`：按已排序的行序列分组，新组条件（满足其一）：
  - 与上一行垂直间隙 > `1.5 * prev.size`；
  - 上一行以 `.!?。！？:：` 结尾且当前行 `x` 比上一行缩进 > `1.5 * prev.size`；
  - 当前行是标题（`headingLevelForLine` 非 null）；
  - 当前行是列表项（`isListItem`）。
  - 续行拼接：上一行以 `-` 结尾且当前行首字符是小写字母 → 去掉 `-` 直接拼接，否则空格拼接。
- `isListItem`：`/^\s*([-•*▪]|\d+[.)])\s+/` 或 `isListItem` 需同时允许"参考文献编号"（由 Task 7 处理，这里只管普通列表）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix frontend run test -- paragraphs.test`
Expected: 7 passed。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/layout/paragraphs.ts frontend/src/layout/paragraphs.test.ts
git commit -m "feat: merge pdf lines into paragraphs and detect headings"
```

---

### Task 7: 参考文献分段与排序

**Files:**
- Create: `frontend/src/layout/references.ts`
- Create: `frontend/src/layout/references.test.ts`

**Interfaces:**
- Produces: `ReferenceEntry { label: string | null; number: number | null; text: string }`
- Produces: `findReferenceSection(lines: TextLine[], bodySize: number): { start: number; end: number } | null`
- Produces: `splitReferenceEntries(lines: TextLine[], bodySize: number): ReferenceEntry[]`
- Produces: `sortReferenceEntries(entries: ReferenceEntry[]): ReferenceEntry[]`

- [ ] **Step 1: 写失败测试**

`references.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { findReferenceSection, sortReferenceEntries, splitReferenceEntries } from "./references";

const line = (baseline: number, text: string, x = 0, size = 10): TextLine => ({
  x, baseline, width: text.length * size * 0.5, size, text,
});

describe("findReferenceSection", () => {
  it("finds the references heading and stops at the next heading", () => {
    const lines = [
      line(0, "Conclusion", 0, 14),
      line(40, "References", 0, 12),
      line(60, "[1] Smith et al. Paper one.", 0, 10),
      line(80, "Appendix", 0, 14),
    ];
    expect(findReferenceSection(lines, 10)).toEqual({ start: 1, end: 3 });
  });
});

describe("splitReferenceEntries", () => {
  it("splits numbered entries and keeps continuation lines", () => {
    const lines = [
      line(0, "[1] Smith et al. A very long title", 0, 10),
      line(12, "continued on the next line", 24, 10),
      line(24, "[2] Jones. Another paper.", 0, 10),
    ];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toContain("continued on the next line");
    expect(entries[0].label).toBe("[1]");
  });

  it("splits hanging-indent entries without numbers", () => {
    const lines = [line(0, "Smith et al. Paper", 0, 10), line(12, "More text", 20, 10), line(24, "Jones. Paper", 0, 10)];
    const entries = splitReferenceEntries(lines, 10);
    expect(entries).toHaveLength(2);
  });
});

describe("sortReferenceEntries", () => {
  it("orders by the leading number", () => {
    const entries = splitReferenceEntries(
      [line(0, "[10] Third", 0, 10), line(12, "[2] First", 0, 10), line(24, "[1] Second", 0, 10)],
      10,
    );
    expect(sortReferenceEntries(entries).map((e) => e.label)).toEqual(["[1]", "[2]", "[10]"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- references.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `references.ts`**

- `findReferenceSection`：找归一化后匹配 `^(references|参考文献|bibliography|works cited|literature cited|引用文献)$` 的行（`start` = 其下一行的索引）；`end` = 从 `start` 起第一个 `size >= bodySize * 1.25` 的行索引，或数组长度。找不到返回 `null`。
- `splitReferenceEntries(lines, bodySize)`：
  - 计算节内正文左边界 = 非悬挂行的最小 `x`（先用带编号的行推断，缺失时用所有行最小 `x`）。
  - 条目起始条件：`/^\s*(\[\d+\]|\d+[.)]|\(\d+\))/` 或 `x < bodyLeft - 0.5 * bodySize`（悬挂缩进）。
  - 其余行并入上一条目（用空格拼接）。
  - `label` = 条目首个编号文本；`number` = 解析出的数字（无则 `null`）。
- `sortReferenceEntries`：有 `number` 的按数字升序排在前面（数字相同时保持原顺序），无编号的保持原相对顺序排在后面。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix frontend run test -- references.test`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/layout/references.ts frontend/src/layout/references.test.ts
git commit -m "feat: split and sort reference entries"
```

---

### Task 8: 嵌入位图抽取

**Files:**
- Create: `frontend/src/layout/pageImages.ts`
- Create: `frontend/src/layout/pageImages.test.ts`

**Interfaces:**
- Produces: `Matrix`（`[a, b, c, d, e, f]`）
- Produces: `multiplyMatrix(m1: Matrix, m2: Matrix): Matrix`
- Produces: `imageRectFromMatrix(m: Matrix): LayoutRect`（PDF 左下原点 → 页面左上原点：`x = e`、`y = f - h`、`w = hypot(a, b)`、`h = hypot(c, d)`）
- Produces: `PlacedImage { rect: LayoutRect; dataUrl: string }`
- Produces: `extractPageImages(page: PDFPageProxy): Promise<PlacedImage[]>`

- [ ] **Step 1: 写失败测试**

`pageImages.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { imageRectFromMatrix, multiplyMatrix } from "./pageImages";

describe("multiplyMatrix", () => {
  it("applies translate after scale", () => {
    const m = multiplyMatrix([1, 0, 0, 1, 0, 0], [2, 0, 0, 2, 10, 20]);
    expect(m).toEqual([2, 0, 0, 2, 10, 20]);
  });
});

describe("imageRectFromMatrix", () => {
  it("converts a PDF placement matrix to page coordinates", () => {
    const rect = imageRectFromMatrix([100, 0, 0, 50, 20, 700]);
    expect(rect).toEqual({ x: 20, y: 650, w: 100, h: 50 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- pageImages.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `pageImages.ts`**

- `multiplyMatrix(m1, m2)`：标准 2D 矩阵乘法（`m1 × m2`，`m2` 先作用）。
- `imageRectFromMatrix(m)`：按上式换算。
- `extractPageImages(page)`：
  1. `const ops = await page.getOperatorList()`。
  2. 遍历 `ops.fnArray`，维护 CTM 栈：`OPS.save` → 栈压当前矩阵；`OPS.restore` → 弹栈；`OPS.transform` → 当前矩阵 = `multiplyMatrix(当前, args)`；遇到 `OPS.paintImageXObject` / `OPS.paintJpegXObject` / `OPS.paintInlineImageXObject` 时记录 `{ objId: args[0], matrix: 当前矩阵 }`（inline image 没有 objId，跳过）。
  3. 对每个记录：`const img = await page.objs.get(objId)`（失败则试 `page.commonObjs.get(objId)`）；取不到或数据非法就跳过并计数。
  4. `rect = imageRectFromMatrix(matrix)`；`w/h` ≤ 0 或超过页宽 1.2 倍时跳过。
  5. 把图像画到离屏 canvas：尺寸 = `rect.w × rect.h`（最长边限制 1600，按比例缩放）；像素来源按 `img.kind` 处理：`"ImageData"` 直接 `putImageData`；`"ImageBitmap"` 用 `drawImage`；`Uint8Array`/RGBA 字节用 `putImageData` 转换；其他类型跳过。
  6. `toDataURL("image/jpeg", 0.92)`。
  7. 返回 `PlacedImage[]`；跳过数量通过返回值第二项 `{ skipped: number }` 一并给出（签名改为 `Promise<{ images: PlacedImage[]; skipped: number }>`）。
- `OPS.paintImageMaskedXObject`、平铺、矢量路径**不处理**，计入 `skipped`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix frontend run test -- pageImages.test`
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/layout/pageImages.ts frontend/src/layout/pageImages.test.ts
git commit -m "feat: extract embedded bitmap images with placement"
```

---

### Task 9: 抽取编排与接入

**Files:**
- Create: `frontend/src/layout/pdfStructure.ts`
- Modify: `frontend/src/readers/PdfReader.tsx`
- Modify: `frontend/src/components/Reader.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `extractPdfStructureReflowed(doc: PDFDocumentProxy, options?: { onProgress?: (done: number, total: number) => void }): Promise<DocumentStructure>`
- Consumes: Task 4 `itemsFromTextContent`/`groupItemsIntoLines`；Task 5 `orderRects`；Task 6 `bodySizeOf`/`mergeLinesIntoParagraphs`/`headingLevelForLine`；Task 7 `findReferenceSection`/`splitReferenceEntries`/`sortReferenceEntries`；Task 8 `extractPageImages`
- Produces: `Reader` prop `readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>`

- [ ] **Step 1: 实现 `pdfStructure.ts`**

逐页流程：

1. `page = await doc.getPage(n)`；`viewport = page.getViewport({ scale: 1 })`。
2. `content = await page.getTextContent()` → `itemsFromTextContent(content.items, viewport.height)` → `groupItemsIntoLines`。
3. `const images = await extractPageImages(page)`（失败时 `images = { images: [], skipped: 0 }` 并 `console.warn`）。
4. 把行转成矩形：`{ x: line.x, y: line.baseline - line.size, w: line.width, h: line.size }`；图片矩形同样加入待排序数组，元素上带 `kind: "line" | "image"` 与原始载荷。
5. `orderRects(elements, viewport.width, viewport.height)` 得到有序元素。
6. 由有序元素得到有序行序列与图片序列（图片在序列中的位置即其插入点）。
7. `bodySize = bodySizeOf(allLines)`。
8. 页眉页脚剔除：仅当行的 `y < 0.06 * viewport.height` 或 `y + h > 0.94 * viewport.height`，且归一化文本在 ≥40% 页面重复出现，且匹配页码样式 `^(\d+|\d+\s*/\s*\d+|[-–—]\s*\d+\s*[-–—]|第\s*\d+\s*页)$` 时丢弃；统计 `removedLines`。
9. 参考文献节：`findReferenceSection` 找到后，该节行用 `splitReferenceEntries` + `sortReferenceEntries` 生成 `reference` 块；节外行照常处理。
10. 其余行按 `mergeLinesIntoParagraphs` 分组；每组：单行且 `headingLevelForLine` 非 null → `heading` 块（`level` 为其值，`level === 1` 且是全文第一个标题 → `title` 块）；否则 `paragraph` 块，正文文本用 `sectionForHeading` 跟踪 `abstract`/`references`/`note`/`meta`/`paragraph`。
11. 图片块：`kind: "figure"`，`image` = data URL；图注：图片下方 120px 内、水平有重叠、且独立成行的文本块挂到 `caption`，被挂的图注不再单独成块。
12. 按最终顺序给所有块编号 `id`（从 1 连续递增），`page = n`。
13. 每页结束调用 `onProgress(n, doc.numPages)`。
14. 全部页结束后：跨页合并相邻 `paragraph`（上一块无句末标点且下一块以小写字母/中文开头 → 合并，保留上一块 `page`）；参考文献块也做同样合并（跨页参考文献条目必须接上）。
15. `notice`：若 `skipped > 0`，写 `本文档有 ${skipped} 处矢量图形或表格未保留（需要版面模型支持）`；若整本文本块为 0，写 `未检测到文字，可能是扫描版 PDF`。

- [ ] **Step 2: 接入 PdfReader**

```ts
readingStructureRef.current = async (onProgress) => {
  return extractPdfStructureReflowed(doc, { onProgress });
};
```

清理时置 `null`；`structureRef` 保持现有启发式不变。

- [ ] **Step 3: 接入 Reader / App**

- `Reader.tsx` 新增 prop `readingStructureRef`，透传给 `PdfReader`、`EpubReader`、`HtmlReader`。
- 非 PDF reader：`readingStructureRef.current = structureRef.current`（HTML/EPUB 的抽取函数签名兼容），清理时置 `null`。
- `App.tsx`：新增 `const readingStructureRef = useRef<ReadingStructureExtractor | null>(null);` 与 `const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null);`；`startReading()` 使用 `readingStructureRef.current ?? structureRef.current`，并把进度回调接到 `setExtractProgress`；`finally` 与缓存命中时清空进度；切换文档时清空进度；`Reader` 传入该 ref；`ReadingView` 传入 `extractProgress`。

- [ ] **Step 4: 验证构建**

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 5: 手动验证（用一篇双栏带图 PDF）**

- 阅读模式：双栏顺序为"左栏读完再右栏"，通栏标题在最前。
- 正文无整段丢失（抽样比对原文）。
- 嵌入位图出现在正确位置。
- 参考文献逐条且按编号有序。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/layout/pdfStructure.ts frontend/src/readers/PdfReader.tsx frontend/src/components/Reader.tsx frontend/src/App.tsx
git commit -m "feat: reflow pdf into continuous reading structure"
```

---

### Task 10: 大纲面板

**Files:**
- Create: `frontend/src/outline.ts`
- Create: `frontend/src/outline.test.ts`
- Modify: `frontend/src/panels/OutlinePanel.tsx`
- Modify: `frontend/src/readers/PdfReader.tsx`
- Modify: `frontend/src/readers/EpubReader.tsx`
- Modify: `frontend/src/readers/HtmlReader.tsx`
- Modify: `frontend/src/components/Reader.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `OutlineEntry { id: string; text: string; level: number; page?: number; href?: string; element?: HTMLElement; action?: () => void }`
- Produces: `flattenPdfOutline(items: PdfOutlineItem[]): OutlineEntry[]`
- Produces: `flattenEpubNav(items: NavItem[]): OutlineEntry[]`
- Produces: `outlineEntriesFromHeadings(headings: { text: string; level: number; element: HTMLElement }[]): OutlineEntry[]`
- Produces: `Reader` prop `outlineRef: MutableRefObject<(() => Promise<OutlineEntry[]>) | null>`

- [ ] **Step 1: 写失败测试**

`outline.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { flattenPdfOutline } from "./outline";

describe("flattenPdfOutline", () => {
  it("keeps nesting levels and resolves page destinations", () => {
    const entries = flattenPdfOutline([
      { title: "Intro", dest: { type: "page-ref", pageNumber: 3 }, items: [
        { title: "Background", dest: { type: "page-ref", pageNumber: 5 } },
      ] },
    ]);
    expect(entries.map((e) => e.level)).toEqual([1, 2]);
    expect(entries.map((e) => e.page)).toEqual([3, 5]);
  });

  it("skips entries without a title", () => {
    expect(flattenPdfOutline([{ title: "", dest: { type: "page-ref", pageNumber: 1 } }])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- outline.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `outline.ts`**

- `flattenPdfOutline(items, level = 1)`：递归遍历 `items`；`title` 为空的条目跳过；`dest.type === "page-ref"` 时 `page = dest.pageNumber + 1`（pdf.js 页索引是 0-based）；其他 dest 类型忽略（无 page）。
- `flattenEpubNav(items, level = 1)`：递归 `toc`；`href` 存 `item.href`。
- `outlineEntriesFromHeadings(headings)`：`id` 用 `heading-${index}`。

- [ ] **Step 4: 接入各 reader 与 OutlinePanel**

- `PdfReader`：`outlineRef.current = async () => { const outline = await doc.getOutline(); return outline ? flattenPdfOutline(outline) : []; }`；无书签时由 `OutlinePanel` 回退到 `structureRef`。
- `EpubReader`：`outlineRef.current = async () => flattenEpubNav(book?.loaded?.navigation?.toc ?? [])`。
- `HtmlReader`：`outlineRef.current = async () => outlineEntriesFromHeadings(collectHeadings(container))`。
- `Reader.tsx` 新增 `outlineRef` prop 并透传；`App.tsx` 新增 `const outlineRef = useRef<(() => Promise<OutlineEntry[]>) | null>(null);` 放进 `PanelContext` 并传给 `Reader`。
- `OutlinePanel.tsx` 重写：只消费 `OutlineEntry[]`；数据来源优先级 `outlineRef` → PDF 用 `structureRef` 的 heading/title 块（回退）→ 非 PDF 用 `collectHeadings`；点击优先级 `action` → `page`（`scrollToPage`）→ `element`（`scrollToElement`）；层级用 `level`；空状态文案沿用现有。

- [ ] **Step 5: 验证测试与构建**

Run: `npm --prefix frontend run test -- outline.test`
Expected: 1 passed。

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/outline.ts frontend/src/outline.test.ts frontend/src/panels/OutlinePanel.tsx frontend/src/readers frontend/src/components/Reader.tsx frontend/src/App.tsx
git commit -m "feat: build outline from pdf bookmarks and epub navigation"
```

---

### Task 11: HTML / EPUB / Markdown 图片

**Files:**
- Create: `frontend/src/layout/images.ts`
- Create: `frontend/src/layout/images.test.ts`
- Modify: `frontend/src/structure.ts`（HTML/EPUB 抽取）
- Modify: `frontend/src/readers/HtmlReader.tsx`
- Modify: `frontend/src/readers/EpubReader.tsx`
- Modify: `frontend/src/components/Reader.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `normalizeRelativeImageSrc(src: string): string`
- Produces: `toImageDataUrl(src: string, docId?: string): Promise<string>`
- Produces: `extractHtmlStructure(root: ParentNode, options?: { docId?: string }): Promise<DocumentStructure>`
- Produces: `extractEpubStructure(rendition: Rendition, options?: { docId?: string }): Promise<DocumentStructure>`
- Produces: `Reader` / `HtmlReader` / `EpubReader` prop `docId: string`

- [ ] **Step 1: 写失败测试**

`images.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { normalizeRelativeImageSrc } from "./images";

describe("normalizeRelativeImageSrc", () => {
  it("decodes and strips query/hash", () => {
    expect(normalizeRelativeImageSrc("figures/a%20b.png?x=1#y")).toBe("figures/a b.png");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- images.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `images.ts`**

```ts
export function normalizeRelativeImageSrc(src: string): string {
  const clean = src.split(/[?#]/)[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}
```

`toImageDataUrl(src, docId)`：
- `data:` 原样返回。
- `blob:`：`fetch` → `blob` → `createImageBitmap` → canvas（最长边 ≤ 1600）→ `toDataURL("image/jpeg", 0.92)`；失败退回 `FileReader` 读成 base64 data URL。
- `http(s):` 原样返回。
- 其他相对路径：`invoke<string>("read_document_image", { id: docId, src: normalizeRelativeImageSrc(src) })` → data URL → 若超长边则再缩放。
- 任何失败都抛出，由调用方捕获并跳过该图。

- [ ] **Step 4: 改造 HTML / EPUB 抽取**

- `HTML_BLOCK_SELECTOR` 加 `,figure,img`。
- `extractHtmlStructure` 改 `async`：
  - `figure` 元素：内部有 `img` → 生成 `figure` 块；`figcaption` 文本作为 `caption`；`img` 的原始 `src` 用 `img.getAttribute("src")`（不能用 `img.src`，那已是应用内 URL）。
  - `img` 元素：生成 `figure` 块，`caption = img.alt || undefined`。
  - 其他元素逻辑不变。
  - 图片转换失败时 `console.warn` 并跳过该图，不影响文字块。
- `extractEpubStructure` 改 `async`，透传 `docId`；rendition 内的 `img` 同样处理（blob URL 转 data URL）。
- 图片块不参与翻译（`CONTENT_KINDS` 不含 `figure`）。

- [ ] **Step 5: 接线 `docId`**

- `App.tsx`：`<Reader ... docId={activeDoc.id} />`。
- `Reader.tsx`：prop `docId`，传给 `HtmlReader` / `EpubReader`。
- `HtmlReader` / `EpubReader`：prop `docId`；`structureRef.current = async () => extractHtmlStructure(container, { docId })` / `async () => extractEpubStructure(rendition, { docId })`。

- [ ] **Step 6: 验证测试与构建**

Run: `npm --prefix frontend run test -- images.test`
Expected: 1 passed。

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 7: 手动验证**

打开带图 Markdown（相对路径图片）和 EPUB，进入阅读模式：
- 图片出现在正确段落之间，图注只出现一次。
- 相对路径图片正常显示；把 `src` 改成 `../../secret.png` 时不应显示外部文件（应被拒绝或显示为空）。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/layout/images.ts frontend/src/layout/images.test.ts frontend/src/structure.ts frontend/src/readers/HtmlReader.tsx frontend/src/readers/EpubReader.tsx frontend/src/components/Reader.tsx frontend/src/App.tsx
git commit -m "feat: keep images in html and epub reading mode"
```

---

### Task 12: 最终验证

**Files:** 无新增；只修验证中发现的问题

- [ ] **Step 1: 自动检查**

```bash
npm --prefix frontend run test
npm --prefix frontend run build
cargo test -p scholarust
cargo check -p scholarust
```

Expected: 全部通过。

- [ ] **Step 2: 手动验收（对照 spec §12）**

准备：一篇双栏带图的英文 PDF、一篇中文 PDF、一篇含 20+ 条参考文献的 PDF、一篇 EPUB、一篇带相对路径图片的 Markdown。

1. 阅读模式无卡片、无 kind 标签、无页码、无逐块翻译按钮。
2. 双栏正文按"左栏读完再右栏"；通栏标题在最前。
3. 逐页核对正文没有整段丢失。
4. 参考文献逐条显示并按编号排序。
5. 嵌入位图在正确段落之间，图注在图下且只出现一次。
6. 译文逐段出现在原文下方；开关可隐藏/恢复。
7. A-/A+ 改字号，重启后保持。
8. EPUB/Markdown 图片正常显示，相对路径图片不 404。
9. 大纲优先显示 PDF 书签（层级与页码正确），点击跳转到对应页。
10. 返回原始视图再进阅读模式不重复抽取（缓存生效）。
11. 矢量图/表格跳过时出现提示条。

- [ ] **Step 3: 修复问题并复跑**

每修一个问题，复跑对应检查；最后再跑 Step 1。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: verify stage 1 reading mode end to end"
```

---

## Self-Review Notes

- Spec §5.1–5.2 → Task 4；§5.3 → Task 5；§5.4–5.5 → Task 6；§5.7 → Task 7；§5.8 → Task 8；§5.9 → Task 9；§6 → Task 3；§7 → Task 10；§8 → Task 11；§10 → Task 1（已完成）；§12 → 各任务 + Task 12。
- 关键数值全部写死：页边 6%、重复 40%、间隙 4%/3%、正文 1.5× 行高、缩进 1.5×、图注 120px、图片 1600px、字号 14–24。
- 类型命名跨任务一致：`LayoutRect`、`TextLine`、`TextItem`（PdfTextItem）、`ReadingStructureExtractor`、`OutlineEntry`。
