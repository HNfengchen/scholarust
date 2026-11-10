# 阅读模式重做（Scholaread 风格）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把阅读模式从卡片式调试视图改成连续单栏文章，并用 DocLayout-YOLO ONNX 抽取 PDF 版面，保留图片/表格在正确位置。

**Architecture:** 前端用 pdf.js 逐页渲染 canvas，缩放到 1024 letterbox 后交给 onnxruntime-web 推理；检测框映射回页面像素，文字按框分配，图片按框裁剪成 data URL，XY-cut 决定阅读顺序。没有模型时回退现有启发式。阅读界面重写为文章排版，译文内联在段落下。

**Tech Stack:** Tauri 2, React 18, TypeScript, pdfjs-dist 4.8, onnxruntime-web 1.20, vite-plugin-static-copy, Vitest, Rust base64.

**Spec:** `docs/superpowers/specs/2026-11-09-reading-mode-scholaread-design.md`

## Global Constraints

- 模型固定路径：`models/layout/doclayout_yolo_docstructbench_imgsz1024.onnx`；`models/` 已 gitignore。
- 模型输入 `images` `[1,3,1024,1024]` float32 RGB 0–1；输出 `[1,300,6]` = `x1,y1,x2,y2,confidence,class_id`；置信度阈值 `0.3`。
- 类别 id 固定：0 title, 1 text, 2 abandon, 3 figure, 4 figure_caption, 5 table, 6 table_caption, 7 table_footnote, 8 formula, 9 formula_caption。
- 字体范围 14–24px，默认 17px；localStorage 键 `scholarust.reading.fontSize`、`scholarust.reading.showTranslation`。
- 不新增 OCR、表格结构识别、公式识别、自动翻译、模型自动下载。
- TypeScript 严格模式开启 `noUnusedLocals`/`noUnusedParameters`；每次改动后 `npm --prefix frontend run build` 必须通过。
- 不改 `extractPdfStructure` 的现有启发式行为；它继续作为 PDF 大纲的回退来源。
- PDF 大纲优先 `doc.getOutline()`，EPUB 优先 `book.loaded.navigation`；打开大纲不触发 ONNX 推理。
- 所有新图片在缓存里必须是 data URL 或原始 http(s) URL，禁止把 EPUB blob URL 放进阅读缓存。

## Review Focus

- **没有模型时**：进入阅读模式必须仍然可读，并出现明确的提示条，不能白屏或抛错。验证：Task 7 手动步骤。
- **扫描版/无文字层 PDF**：不能崩溃；没有文字块时显示空提示。验证：Task 7 手动步骤。
- **相对图片路径穿越文档目录**：`../../secret.png` 必须被 Rust 拒绝。验证：Task 1 单测。
- **没有被任何版面框覆盖的文字**：不能丢，必须作为补漏块进入结果。验证：Task 4 `assignTextItems` 单测 + Task 7 手动检查。
- **图注重复**：挂到图片上的 caption 不能再作为独立块出现。验证：Task 4 `pickCaption` 单测 + Task 7 手动检查。
- **PDF 内嵌书签目标页失效**：跳过坏条目并回退启发式，不能显示空大纲或崩溃。验证：Task 9 `flattenPdfOutline` 单测 + 手动步骤。

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
- Modify: `app/src/model.rs`（`impl ModelManager` 内）
- Modify: `app/src/commands.rs`（文件末尾）
- Modify: `app/src/lib.rs:52-76`
- Modify: `README.md`（Hy-MT2 模型小节之后）

**Interfaces:**
- Produces: `ModelManager::layout_model_path(&self) -> PathBuf`
- Produces: `#[tauri::command] pub async fn layout_model_info(app: AppHandle, state: State<'_, AppState>) -> Result<LayoutModelInfo, String>`，序列化为 `{ path: string, exists: boolean }`
- Produces: `#[tauri::command] pub async fn read_document_image(state: State<'_, AppState>, id: String, src: String) -> Result<String, String>`，返回 `data:<mime>;base64,...`
- Produces: `fn resolve_document_image_path(base: &Path, src: &str) -> Result<PathBuf, String>`

- [ ] **Step 1: 写失败的路径安全测试**

在 `app/src/commands.rs` 末尾添加：

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

实现 `read_document_image`（`async`）：`let library = state.library.lock().await; let doc = library.get(&id).ok_or_else(|| format!("document not found: {id}"))?;`，克隆 `doc.path` 后释放锁，按父目录调用 helper；按扩展名映射 mime（png/jpg/jpeg/gif/webp/svg/bmp），`base64::engine::general_purpose::STANDARD.encode(bytes)`，返回 data URL。实现 `layout_model_info`（`async`）：`state.model.layout_model_path()`，存在时 `app.asset_protocol_scope().allow_file(&path)`。

`model.rs` 的 `impl ModelManager` 增加：

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

- [ ] **Step 5: README 增加模型下载**

在 Hy-MT2 小节后加：

```markdown
## 版面模型（阅读模式）

PDF 阅读模式使用 DocLayout-YOLO 识别版面。未放模型时会回退到简化抽取。

    mkdir -p models/layout
    curl -L -o models/layout/doclayout_yolo_docstructbench_imgsz1024.onnx \
      https://hf-mirror.com/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx
```

- [ ] **Step 6: 提交**

```bash
git add Cargo.lock app/Cargo.toml app/src/model.rs app/src/commands.rs app/src/lib.rs README.md
git commit -m "feat: add layout model and document image commands"
```

---

### Task 2: 阅读结构类型与 figure 块

**Files:**
- Modify: `frontend/src/structure.ts:4-42`

**Interfaces:**
- Produces: `BlockKind` 增加 `"figure"`；`StructuredBlock` 增加 `image?: string`、`caption?: string`
- Produces: `DocumentStructure.notice?: string`
- Produces: `export type ReadingStructureExtractor = (onProgress?: (done: number, total: number) => void) => Promise<DocumentStructure>`
- Produces: `export type Section = "front" | "abstract" | "body" | "references" | "notes"`
- Produces: `export function sectionForHeading(text: string): Section | null`（把现有函数加 `export`）

- [ ] **Step 1: 修改类型**

`BlockKind` 加 `| "figure"`；`StructuredBlock` 加 `image?: string; caption?: string;`；`DocumentStructure` 加 `notice?: string;`；新增 `ReadingStructureExtractor`；`BLOCK_KIND_LABELS` 加 `figure: "图片"`；`type Section` 前加 `export`，`sectionForHeading` 前加 `export`。`CONTENT_KINDS` 不变。

- [ ] **Step 2: 验证构建**

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/structure.ts
git commit -m "feat: add figure blocks and reading structure types"
```

---

### Task 3: 阅读界面重写

**Files:**
- Modify: `frontend/package.json`（`vitest` devDependency、`test` script）
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/components/readingSettings.ts`
- Create: `frontend/src/components/readingSettings.test.ts`
- Modify: `frontend/src/components/ReadingView.tsx`（整体替换）
- Modify: `frontend/src/styles.css:1237-1391`
- Modify: `frontend/src/App.tsx:297-330,561-570`

**Interfaces:**
- Produces: `clampFontSize(value: number): number`、`nextFontSize(current: number, delta: number): number`、`READING_FONT_MIN = 14`、`READING_FONT_MAX = 24`
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
- 根节点 `.reading`；顶部 `.reading-toolbar`（sticky），显示 `title`、A-/A+、`译文` checkbox、`翻译正文` 按钮。
- 正文 `.reading-article`，`style={{ "--reading-font-size": `${fontSize}px` } as CSSProperties}`。
- `fontSize` 初始值读 `localStorage["scholarust.reading.fontSize"]`（try/catch，无效用 17）；变化时写回。
- `showTranslation` 初始值读 `localStorage["scholarust.reading.showTranslation"] !== "false"`（try/catch）；变化时写回。
- `loading` 时显示 spinner；有 `extractProgress` 显示 `正在识别版面… ${done}/${total} 页`，否则 `正在解析文档…`。
- `structure.notice` 且用户未关闭时显示 `.reading-notice`；关闭按钮调用 `setNoticeOpen(false)`。
- `structure && structure.blocks.length === 0` 时正文显示 `.empty-hint`：`没有可阅读的文本（可能是扫描版 PDF）。`
- 遍历 `structure.blocks`：
  - `title` → `<h1 className="reading-text">`
  - `heading` → `level <= 1 ? h2 : h3`，`className="reading-text"`
  - `figure` → 有 `image` 时 `<figure className="reading-figure"><img src={image} alt={caption ?? ""} loading="lazy" />{caption && <figcaption>...}</figure>`；无图跳过
  - 其他 → `<div className={`reading-block reading-kind-${kind}`}><p className="reading-text">...`
- 每个非 figure 块之后渲染译文（`showTranslation && translation?.status === "done"`）：`.reading-translation`。
- 翻译中显示一行 `.reading-translating`；错误显示 `.reading-error` + 文字按钮“重试”，调用 `onTranslateBlock(block)`。
- `翻译正文` 按钮：`batchRunning` 时显示 `翻译中 done/total`；`pendingCount === 0` 时显示 `正文已全部翻译` 并禁用；点击 `await onTranslateContent(); setShowTranslation(true);`。
- 删除 `BLOCK_KIND_LABELS`、页码、kind 标签、每块翻译按钮。

- [ ] **Step 5: 替换阅读样式**

删除 `.reading` 旧卡片样式到 `.reading-block-actions` 之间（约 1237–1391 行），保留 `.btn-small`、`.btn-danger`。新增：

```css
.reading { max-width: 820px; margin: 0 auto; padding: 0 32px 96px; }
.reading-toolbar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 0 -32px 28px; padding: 12px 32px; background: rgba(245, 246, 248, 0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
.reading-toolbar-title { min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reading-toolbar-actions { display: flex; align-items: center; gap: 8px; }
.reading-font-label { min-width: 28px; text-align: center; color: var(--muted); font-size: 12px; }
.reading-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); }
.reading-article { max-width: 46rem; margin: 0 auto; font-size: var(--reading-font-size, 17px); line-height: 1.85; }
.reading-article h1 { margin: 0 0 0.9em; font-size: 1.9em; line-height: 1.35; letter-spacing: -0.01em; }
.reading-article h2 { margin: 1.8em 0 0.6em; font-size: 1.35em; line-height: 1.45; }
.reading-article h3 { margin: 1.5em 0 0.5em; font-size: 1.12em; line-height: 1.5; }
.reading-block { margin: 0 0 1.35em; }
.reading-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
.reading-kind-note .reading-text, .reading-kind-references .reading-text, .reading-kind-meta .reading-text, .reading-kind-caption .reading-text { font-size: 0.86em; color: var(--muted); }
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

传入 `extractProgress={null}`（Task 7 再改成真实状态），`onTranslateContent={() => translateContent()}`；`onTranslateBlock` 保留。`startReading` 的“空结果”判断改为 `if (parsed.blocks.length === 0 && !parsed.notice) throw new Error("未解析到可阅读的内容块");`，让扫描版 PDF 的 notice 结构进入阅读模式并显示空提示。

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

### Task 4: 版面几何与文字分配

**Files:**
- Create: `frontend/src/layout/types.ts`
- Create: `frontend/src/layout/geometry.ts`
- Create: `frontend/src/layout/geometry.test.ts`

**Interfaces:**
- Produces: `MODEL_INPUT_SIZE = 1024`、`MODEL_PAD_VALUE = 114`、`CONFIDENCE_THRESHOLD = 0.3`
- Produces: `Letterbox { scale, padX, padY, drawW, drawH }`
- Produces: `LayoutClass`、`LayoutBox { x, y, w, h, confidence, cls }`、`TextItem { x, top, width, size, str }`
- Produces: `letterboxGeometry(srcWidth, srcHeight, size?): Letterbox`
- Produces: `parseDetections(output: Float32Array, count?, threshold?): RawDetection[]`
- Produces: `detectionToBox(det, geom, srcWidth, srcHeight): LayoutBox`
- Produces: `assignTextItems(items, boxes): { assigned: TextItem[][]; unassigned: TextItem[]; removed: number }`
- Produces: `pickCaption(image: LayoutBox, captions: LayoutBox[], maxDistance?): number | null`

- [ ] **Step 1: 确认 Vitest 已配置**

Task 3 已安装 Vitest 并创建 `frontend/vitest.config.ts`；本任务直接写测试。

- [ ] **Step 2: 写失败的几何测试**

`geometry.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  assignTextItems,
  detectionToBox,
  letterboxGeometry,
  parseDetections,
  pickCaption,
} from "./geometry";
import type { LayoutBox, TextItem } from "./types";

const itemAt = (cx: number, cy: number): TextItem => ({
  x: cx - 5, top: cy - 5, width: 10, size: 10, str: "x",
});
const box = (x: number, y: number, w: number, h: number): LayoutBox => ({
  x, y, w, h, confidence: 1, cls: "text",
});

describe("letterbox", () => {
  it("centers a 600x800 page", () => {
    const g = letterboxGeometry(600, 800, 1024);
    expect(g.scale).toBeCloseTo(1.28);
    expect(g.drawW).toBeCloseTo(768);
    expect(g.drawH).toBeCloseTo(1024);
    expect(g.padX).toBeCloseTo(128);
    expect(g.padY).toBeCloseTo(0);
  });
});

describe("detections", () => {
  it("parses and filters by confidence", () => {
    const out = new Float32Array(12);
    out.set([100, 100, 200, 200, 0.9, 0], 0);
    out.set([300, 300, 400, 400, 0.2, 3], 6);
    expect(parseDetections(out, 2)).toHaveLength(1);
  });

  it("maps back to source pixels and class", () => {
    const g = { scale: 2, padX: 10, padY: 20, drawW: 200, drawH: 300 };
    const mapped = detectionToBox(
      { x1: 50, y1: 60, x2: 150, y2: 260, confidence: 0.9, classId: 3 },
      g, 100, 150,
    );
    expect(mapped).toMatchObject({ x: 20, y: 20, w: 50, h: 100, cls: "figure" });
    expect((mapped.x + mapped.w / 2) * g.scale + g.padX).toBeCloseTo(100, 0);
    expect((mapped.y + mapped.h / 2) * g.scale + g.padY).toBeCloseTo(160, 0);
  });
});

describe("text assignment", () => {
  it("assigns by center, drops abandon, keeps leftovers", () => {
    const boxes: LayoutBox[] = [
      { ...box(0, 0, 100, 20), cls: "title" },
      box(0, 30, 500, 500),
      { ...box(0, 600, 500, 200), cls: "figure" },
      { ...box(0, 900, 500, 50), cls: "abandon" },
    ];
    const result = assignTextItems(
      [itemAt(50, 10), itemAt(100, 100), itemAt(100, 700), itemAt(100, 920), itemAt(900, 500)],
      boxes,
    );
    expect(result.assigned[0]).toHaveLength(1);
    expect(result.assigned[1]).toHaveLength(1);
    expect(result.removed).toBe(1);
    expect(result.unassigned).toHaveLength(2);
  });
});

describe("caption picking", () => {
  it("picks the nearest overlapping caption only", () => {
    const image = box(0, 100, 400, 300);
    expect(pickCaption(image, [box(50, 420, 300, 40)])).toBe(0);
    expect(pickCaption(image, [box(50, 700, 300, 40)])).toBeNull();
    expect(pickCaption(image, [box(450, 420, 100, 40)])).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm --prefix frontend run test -- geometry`
Expected: 失败，模块不存在。

- [ ] **Step 4: 实现 `types.ts` 与 `geometry.ts`**

`types.ts` 定义上述类型，`LayoutClass` 使用 10 个字符串字面量。`geometry.ts`：
- `letterboxGeometry`：`scale = min(size/srcW, size/srcH)`，`drawW/srcW` 等比，`padX=(size-drawW)/2`，`padY` 同理。
- `parseDetections`：步长 6，过滤 `confidence < threshold`。
- `detectionToBox`：`(x-padX)/scale` 等，`w/h` 同理，`cls` 由 `classId` 映射数组得到。
- `assignTextItems`：对每个 item 用中心点；候选框只包含 `title/text/figure_caption/table_caption/formula_caption/table_footnote`；优先级 `title > text > caption`；若中心在 `abandon` 框内则 `removed++`；每个 item 只分配一次；其余进 `unassigned`。
- `pickCaption`：caption 与 image 水平重叠宽度 > 0；垂直距离（图下方或上方）`<= maxDistance`（默认 120）；取最近索引。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm --prefix frontend run test -- geometry`
Expected: 5 passed。

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/layout
git commit -m "feat: add layout geometry helpers"
```

---

### Task 5: 文字行、段落与标题分级

**Files:**
- Create: `frontend/src/layout/text.ts`
- Create: `frontend/src/layout/text.test.ts`

**Interfaces:**
- Produces: `TextLine { x, top, size, text }`
- Produces: `TextParagraph { x, top, size, text }`
- Produces: `itemsToLines(items: TextItem[]): TextLine[]`
- Produces: `groupParagraphs(lines: TextLine[], regionLeft: number, bodySize: number): TextParagraph[]`
- Produces: `headingLevelForLine(line: TextLine, bodySize: number): number | null`

- [ ] **Step 1: 写失败测试**

`text.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { groupParagraphs, headingLevelForLine, itemsToLines } from "./text";

describe("itemsToLines", () => {
  it("merges items on the same baseline from left to right", () => {
    const lines = itemsToLines([
      { x: 50, top: 10, width: 20, size: 10, str: "world" },
      { x: 10, top: 10, width: 20, size: 10, str: "hello" },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("hello world");
  });
});

describe("groupParagraphs", () => {
  const line = (top: number, text: string, x = 0) => ({ x, top, size: 10, text });

  it("splits when the gap exceeds 1.45 line heights", () => {
    const paragraphs = groupParagraphs([line(0, "one"), line(10, "two"), line(30, "three")], 0, 10);
    expect(paragraphs.map((p) => p.text)).toEqual(["one two", "three"]);
  });

  it("splits on an indented line after terminal punctuation", () => {
    const paragraphs = groupParagraphs([line(0, "one."), line(10, "two", 20)], 0, 10);
    expect(paragraphs.map((p) => p.text)).toEqual(["one.", "two"]);
  });

  it("joins hyphenated line breaks", () => {
    const paragraphs = groupParagraphs([line(0, "inter-"), line(10, "national")], 0, 10);
    expect(paragraphs.map((p) => p.text)).toEqual(["international"]);
  });
});

describe("headingLevelForLine", () => {
  it("uses size thresholds and short text", () => {
    expect(headingLevelForLine({ x: 0, top: 0, size: 17, text: "Title" }, 10)).toBe(1);
    expect(headingLevelForLine({ x: 0, top: 0, size: 13, text: "Section" }, 10)).toBe(2);
    expect(headingLevelForLine({ x: 0, top: 0, size: 11, text: "Small heading" }, 10)).toBe(3);
    expect(headingLevelForLine({ x: 0, top: 0, size: 10, text: "Body" }, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- text.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `text.ts`**

- `itemsToLines`：按 `top` 聚类（容差 `max(1, size*0.4)`），组内按 `x` 排序，空格拼接；行 `x` 取最小。
- `groupParagraphs`：按 `top` 排序；新段条件：首行、`gap > prev.size*1.45`、或 `line.x > regionLeft + bodySize*1.5` 且上一行以 `.!?。！？` 结尾；合并时若上一行以 `-` 结尾且下一行小写，去掉 `-` 直接拼，否则空格拼接。
- `headingLevelForLine`：`>=1.6*body` → 1；`>=1.25*body` → 2；`>=1.08*body && text.length < 90` → 3；否则 `null`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix frontend run test -- text.test`
Expected: 6 passed。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/layout/text.ts frontend/src/layout/text.test.ts
git commit -m "feat: add pdf text paragraph grouping"
```

---

### Task 6: XY-cut 阅读顺序

**Files:**
- Create: `frontend/src/layout/order.ts`
- Create: `frontend/src/layout/order.test.ts`

**Interfaces:**
- Produces: `OrderBox { x, y, w, h }`
- Produces: `orderBoxes<T extends OrderBox>(boxes: T[], pageWidth: number, pageHeight: number): T[]`

- [ ] **Step 1: 写失败测试**

`order.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { orderBoxes } from "./order";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("orderBoxes", () => {
  it("reads two columns left then right", () => {
    const ordered = orderBoxes(
      [box(0, 100, 100, 20), box(200, 100, 100, 20), box(0, 300, 100, 20), box(200, 300, 100, 20)],
      400, 500,
    );
    expect(ordered.map((b) => b.x)).toEqual([0, 0, 200, 200]);
  });

  it("keeps a full-width title before both columns", () => {
    const ordered = orderBoxes(
      [box(0, 0, 400, 30), box(0, 100, 150, 200), box(250, 100, 150, 200)],
      400, 500,
    );
    expect(ordered[0].y).toBe(0);
    expect(ordered.map((b) => b.x)).toEqual([0, 0, 250]);
  });

  it("reads a single column top to bottom", () => {
    const ordered = orderBoxes([box(0, 300, 400, 20), box(0, 100, 400, 20), box(0, 200, 400, 20)], 400, 500);
    expect(ordered.map((b) => b.y)).toEqual([100, 200, 300]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- order.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `order.ts`**

递归 `orderBoxes`：
1. `boxes.length <= 1` 返回。
2. 找 x 方向最大内部空白：把每个 box 的 `[x, x+w]` 合并区间，找间隔；间隔 `>= pageWidth*0.04` 时按间隔中点分左右，先左后右递归。
3. 否则找 y 方向最大内部空白，`>= pageHeight*0.03` 时按中点分上下，先上后下递归。
4. 都没有则按 `(y, x)` 排序。
5. 任一次切分产生空组，退回排序，避免死循环。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix frontend run test -- order.test`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/layout/order.ts frontend/src/layout/order.test.ts
git commit -m "feat: add xy-cut reading order"
```

---

### Task 7: ONNX 推理与 PDF 版面抽取

**Files:**
- Modify: `frontend/package.json`（`onnxruntime-web`、`vite-plugin-static-copy`）
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/layout/model.ts`
- Create: `frontend/src/layout/pdfLayout.ts`
- Modify: `frontend/src/types.ts`（`LayoutModelInfo`）
- Modify: `frontend/src/api.ts`（`layoutModelInfo`、`readDocumentImage`）
- Modify: `frontend/src/readers/PdfReader.tsx`
- Modify: `frontend/src/readers/EpubReader.tsx`
- Modify: `frontend/src/readers/HtmlReader.tsx`
- Modify: `frontend/src/components/Reader.tsx`
- Modify: `frontend/src/App.tsx:65-71,297-330,561-570`

**Interfaces:**
- Produces: `LayoutModelInfo { path: string; exists: boolean }`
- Produces: `api.layoutModelInfo(): Promise<LayoutModelInfo>`
- Produces: `api.readDocumentImage(id: string, src: string): Promise<string>`
- Produces: `loadLayoutSession(modelUrl: string): Promise<ort.InferenceSession>`
- Produces: `runLayoutOnCanvas(session, canvas): Promise<{ detections: LayoutBox[]; geometry: Letterbox }>`
- Produces: `extractPdfStructureWithLayout(doc, { modelUrl, onProgress }): Promise<DocumentStructure>`
- Consumes: Task 4–6 的 `geometry.ts`、`text.ts`、`order.ts`；Task 2 的 `ReadingStructureExtractor`

- [ ] **Step 1: 安装依赖并接线 ORT 资源**

```bash
npm --prefix frontend install onnxruntime-web@^1.20.0
npm --prefix frontend install -D vite-plugin-static-copy@^2.3.0
```

`vite.config.ts`：

```ts
import { viteStaticCopy } from "vite-plugin-static-copy";

plugins: [
  react(),
  viteStaticCopy({
    targets: [{ src: "node_modules/onnxruntime-web/dist/*.{wasm,mjs}", dest: "ort" }],
  }),
],
```

- [ ] **Step 2: 增加前端 API**

`types.ts` 加 `LayoutModelInfo`；`api.ts`：

```ts
export function layoutModelInfo(): Promise<LayoutModelInfo> {
  return invoke<LayoutModelInfo>("layout_model_info");
}

export function readDocumentImage(id: string, src: string): Promise<string> {
  return invoke<string>("read_document_image", { id, src });
}
```

- [ ] **Step 3: 实现 `model.ts`**

- 模块级 `let sessionPromise: Promise<ort.InferenceSession> | null = null;`
- `loadLayoutSession(modelUrl)`：设置 `ort.env.wasm.wasmPaths = "/ort/"`、`numThreads = 1`、`proxy = true`；`fetch(modelUrl)` 取 `arrayBuffer`，`ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ["wasm"] })`，缓存 promise。
- `runLayoutOnCanvas`：按 `letterboxGeometry(canvas.width, canvas.height)` 创建 1024 canvas，填 `rgb(114,114,114)`，`drawImage` 到 `padX/padY/drawW/drawH`；`getImageData` 转 CHW float32；用 `session.inputNames[0]` 作为输入名、`session.outputNames[0]` 取输出；`parseDetections` + `detectionToBox` 映射回 canvas 像素。

- [ ] **Step 4: 实现 `pdfLayout.ts`**

逐页（`let section: Section = "front"; let titleEmitted = false;` 放在页循环外）：
1. `renderScale = max(2, 1024 / base.width)`，再限制最长边 ≤ 3200；创建 canvas，`page.render({ canvasContext, viewport })`。
2. `page.getTextContent()` 转 `TextItem[]`：`x = transform[4]*scale`，`top = (base.height - transform[5] - size)*scale`，`width = (item.width || item.str.length * size * 0.5)*scale`，`size = abs(transform[3])*scale`，跳过空字符串。
3. `runLayoutOnCanvas` 得到 `detections`（已映射到页面像素）。
4. `assignTextItems(items, detections)`；每个文字区域用 `itemsToLines` + `groupParagraphs`；`bodySize` 用当前页长度 ≥20 的 item 按字符数加权众数（取整到 0.5）。
5. 区域转块：
   - `title` 区域：第一段在 page 1 且 `!titleEmitted` → `kind: "title"`, `titleEmitted = true`；同一区域剩余段落 → `kind: "meta"`；其他 title 区域 → `kind: "heading", level: 1`。
   - `text` 区域：每个段落，若 `headingLevelForLine` 非空且段落只有一行 → `kind: "heading"`，`level` 用返回值，并用 `sectionForHeading(text)` 更新 `section`；否则按 `section` 映射：`abstract` → `abstract`，`references` → `references`，`notes` → `note`，其余 → `paragraph`。
   - caption 区域：先记为 caption 候选，带 `box`。
   - `figure/table/formula`：裁剪 canvas（box 加 8px padding，clamp）；最长边超过 1600 时缩放；`figure` 用 JPEG 0.92，`table/formula` 用 PNG；块 `kind: "figure", image: dataUrl`。
   - `abandon`：不生成块，`removed` 已由 `assignTextItems` 统计。
6. `orderBoxes` 排区域；图片区域与其文字/图注区域按顺序输出。
7. `pickCaption`：对每个图片，在 caption 候选中找最近且未使用的；命中则 `image.caption = caption.text`，删除该 caption 块；未命中保留为 `kind: "caption"` 块。
8. 未分配文字：用 `itemsToLines` + `groupParagraphs`；单行且 `headingLevelForLine` 非空时生成 `heading`，否则生成 `paragraph`，追加到本页末尾。
9. 所有块按顺序分配从 1 开始的连续数字 `id`；`page` 为页码；`level` 默认 0。
10. 全部页完成后，合并相邻 `paragraph`：上一块不以 `.!?。！？` 结尾且下一块以小写字母/中文开头时合并；保留上一块 `page`。
11. 每页结束调用 `onProgress(pageNumber, doc.numPages)`，并 `page.cleanup()`；每页 canvas 用完后释放引用。
12. 如果最终 `blocks.length === 0`，返回 `{ blocks: [], removedLines, notice: "未检测到可阅读的文字（可能是扫描版 PDF）" }`；否则返回 `{ blocks, removedLines }`。

- [ ] **Step 5: 接线 PdfReader / Reader / App**

`Reader.tsx` 加 prop：

```ts
readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
```

传给 `PdfReader`、`EpubReader`、`HtmlReader`。非 PDF reader 在 `register()` 里设置 `readingStructureRef.current = structureRef.current`，清理时置 `null`；`docId` 暂不传（Task 8 再加）。

`PdfReader` 加 prop `readingStructureRef`，在 `structureRef` 设置后：

```ts
let readingPromise: Promise<DocumentStructure> | null = null;
readingStructureRef.current = (onProgress) => {
  readingPromise ??= (async () => {
    try {
      const info = await api.layoutModelInfo();
      if (!info.exists) {
        return { ...(await extractPdfStructure(doc)), notice: `未找到版面模型，已使用简化抽取：${info.path}` };
      }
      return await extractPdfStructureWithLayout(doc, { modelUrl: convertFileSrc(info.path), onProgress });
    } catch (err) {
      console.warn("layout extraction failed", err);
      return { ...(await extractPdfStructure(doc)), notice: "版面模型运行失败，已使用简化抽取" };
    }
  })();
  return readingPromise;
};
```

清理时置 `null`。

`App`：
- `const readingStructureRef = useRef<ReadingStructureExtractor | null>(null);`
- `const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null);`
- `startReading` 用 `readingStructureRef.current ?? structureRef.current`；调用时传 `(done, total) => { if (activeDocIdRef.current === doc.id) setExtractProgress({ done, total }); }`；`finally` 和缓存命中时 `setExtractProgress(null)`。
- 文档切换时 `setExtractProgress(null)`。
- `Reader` 传入 `readingStructureRef`。
- `ReadingView` 传入 `extractProgress={extractProgress}`。

- [ ] **Step 6: 验证构建**

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 7: 手动验证（需要模型）**

下载模型到 `models/layout/` 后运行 `npm run dev`，打开双栏带图 PDF，进入阅读模式：
- 显示“正在识别版面 x/y 页”。
- 双栏顺序正确，图片在正确位置。
- 临时把模型文件改名，再进阅读模式：回退可读 + 提示条。
- 打开没有文字层的扫描 PDF：阅读模式显示空提示，不崩溃。
- 如果某页有框外文字，确认没有丢失（Task 4 的 `unassigned` 已追加）。

- [ ] **Step 8: 提交**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/layout/model.ts frontend/src/layout/pdfLayout.ts frontend/src/types.ts frontend/src/api.ts frontend/src/readers frontend/src/components/Reader.tsx frontend/src/App.tsx
git commit -m "feat: run doclayout-yolo for pdf reading mode"
```

---

### Task 8: HTML / EPUB / Markdown 图片

**Files:**
- Modify: `frontend/src/structure.ts:414-461`
- Create: `frontend/src/layout/images.ts`
- Create: `frontend/src/layout/images.test.ts`
- Modify: `frontend/src/readers/HtmlReader.tsx`
- Modify: `frontend/src/readers/EpubReader.tsx`
- Modify: `frontend/src/components/Reader.tsx`
- Modify: `frontend/src/App.tsx:552-559`

**Interfaces:**
- Produces: `normalizeRelativeImageSrc(src: string): string`（去掉 `?`/`#`、`decodeURIComponent`）
- Consumes: `api.readDocumentImage`（Task 7）
- Produces: `extractHtmlStructure(root: ParentNode, options?: { docId?: string }): Promise<DocumentStructure>`
- Produces: `extractEpubStructure(rendition: Rendition, options?: { docId?: string }): Promise<DocumentStructure>`
- Produces: `Reader` / `HtmlReader` / `EpubReader` 新 prop `docId: string`

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

- [ ] **Step 4: 改造 HTML 抽取**

- `HTML_BLOCK_SELECTOR` 加 `,figure,img`。
- `extractHtmlStructure` 改 `async`，返回 `Promise<DocumentStructure>`。
- 在循环里：
  - `tag === "figure"`：找 `img`，有则生成 `figure` 块；`figcaption` 文本作为 `caption`；`image` 通过 `resolveImage` 得到；`continue`。
  - `tag === "img"`：生成 `figure` 块，`caption = alt || undefined`。
  - 其他保持现有逻辑。
- `resolveImage(rawSrc, resolvedSrc, docId)`（调用时传 `img.getAttribute("src") ?? ""` 和 `img.currentSrc || img.src`，这样 Markdown 的相对路径不会被浏览器解析成绝对 http URL）：
  - `rawSrc` 以 `data:` 开头：原样返回。
  - `rawSrc` 以 `http(s):` 开头：原样返回。
  - `resolvedSrc` 以 `blob:` 开头：`fetch(resolvedSrc)` → `blob` → `downscaleDataUrl(blob)`。
  - 其他：`api.readDocumentImage(docId, normalizeRelativeImageSrc(rawSrc))`，再 `downscaleDataUrl`。
- `downscaleDataUrl`：用 `Image` 加载；最长边 ≤ 1600 时，blob 用 `FileReader` 转 data URL，data URL 原样；超限时 canvas 等比缩放后 `toDataURL("image/jpeg", 0.92)`；解码失败时，blob 也必须用 `FileReader` 转 data URL 兜底，不能把 blob URL 返回给缓存。
- `extractEpubStructure` 改 `async`，透传 `docId`。
- 图片转换失败时 `console.warn` 并跳过该块，不阻塞正文。

- [ ] **Step 5: 接线 `docId`**

- `App` 的 `<Reader ... docId={activeDoc.id} />`。
- `Reader` props 加 `docId`，传给 `HtmlReader` / `EpubReader`。
- `HtmlReader` / `EpubReader` props 加 `docId`；`structureRef.current = async () => extractHtmlStructure(container, { docId })` / `extractEpubStructure(rendition, { docId })`。
- `readingStructureRef.current = structureRef.current`（Task 7 已加）。

- [ ] **Step 6: 验证测试与构建**

Run: `npm --prefix frontend run test -- images.test`
Expected: 1 passed。

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 7: 手动验证**

打开带图 Markdown（相对路径图片）和 EPUB，进入阅读模式：
- 图片出现在正确段落之间。
- 图注只出现一次。
- 相对路径图片正常显示；把 `src` 改成 `../../secret.png` 时不应显示外部文件。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/structure.ts frontend/src/layout/images.ts frontend/src/layout/images.test.ts frontend/src/readers/HtmlReader.tsx frontend/src/readers/EpubReader.tsx frontend/src/components/Reader.tsx frontend/src/App.tsx
git commit -m "feat: keep images in html and epub reading mode"
```

---

### Task 9: 大纲面板

**Files:**
- Create: `frontend/src/outline.ts`
- Create: `frontend/src/outline.test.ts`
- Modify: `frontend/src/panels/registry.ts:13-29`
- Modify: `frontend/src/panels/OutlinePanel.tsx`（整体替换）
- Modify: `frontend/src/readers/PdfReader.tsx`
- Modify: `frontend/src/readers/EpubReader.tsx`
- Modify: `frontend/src/readers/HtmlReader.tsx`
- Modify: `frontend/src/components/Reader.tsx`
- Modify: `frontend/src/App.tsx:65-67,460-477,552-565`

**Interfaces:**
- Produces: `OutlineEntry { id, text, level, page?, href?, element?, action? }`
- Produces: `OutlineExtractor = () => Promise<OutlineEntry[]>`
- Produces: `flattenPdfOutline(nodes: PdfOutlineNode[], level?: number): OutlineEntry[]`
- Produces: `flattenEpubNav(nodes: EpubNavNode[], level?: number): OutlineEntry[]`
- Produces: `outlineEntriesFromHeadings(headings: Array<{ text: string; level: number; element: HTMLElement }>): OutlineEntry[]`
- Produces: `PanelContext.outlineRef: MutableRefObject<OutlineExtractor | null>`

- [ ] **Step 1: 写失败测试**

`frontend/src/outline.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { flattenEpubNav, flattenPdfOutline } from "./outline";

describe("flattenPdfOutline", () => {
  it("keeps levels and resolved pages, skips empty titles", () => {
    const entries = flattenPdfOutline([
      {
        title: "Intro", page: 1,
        items: [{ title: "Method", page: 3, items: [{ title: "Data", page: 4 }] }],
      },
      { title: "", page: 5 },
    ]);
    expect(entries.map((e) => [e.text, e.level, e.page])).toEqual([
      ["Intro", 1, 1],
      ["Method", 2, 3],
      ["Data", 3, 4],
    ]);
  });

  it("keeps entries whose destination could not be resolved", () => {
    expect(flattenPdfOutline([{ title: "No dest" }])[0].page).toBeUndefined();
  });
});

describe("flattenEpubNav", () => {
  it("keeps href and nesting", () => {
    const entries = flattenEpubNav([
      { label: "Chapter 1", href: "ch1.xhtml", subitems: [{ label: "Section", href: "ch1.xhtml#s1" }] },
    ]);
    expect(entries.map((e) => [e.text, e.level, e.href])).toEqual([
      ["Chapter 1", 1, "ch1.xhtml"],
      ["Section", 2, "ch1.xhtml#s1"],
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test -- outline.test`
Expected: 失败，模块不存在。

- [ ] **Step 3: 实现 `outline.ts`**

```ts
export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
  page?: number;
  href?: string;
  element?: HTMLElement;
  action?: () => void | Promise<void>;
}
export type OutlineExtractor = () => Promise<OutlineEntry[]>;

export interface PdfOutlineNode {
  title: string;
  dest?: string | unknown[] | null;
  page?: number;
  items?: PdfOutlineNode[];
}
export interface EpubNavNode {
  label: string;
  href?: string;
  subitems?: EpubNavNode[];
}
```

`flattenPdfOutline` / `flattenEpubNav` 递归，跳过空标题但继续遍历子项；`id` 用模块内递增计数（`pdf-1`、`epub-1`）。`outlineEntriesFromHeadings` 用 `html-${index}`。

- [ ] **Step 4: 接线 PDF 内嵌书签**

`PdfReader` 增加 `outlineRef` prop。`doc` 加载后：

```ts
let outlinePromise: Promise<OutlineEntry[]> | null = null;
outlineRef.current = () => {
  outlinePromise ??= (async () => {
    const nodes = (await doc.getOutline()) as PdfOutlineNode[] | null;
    if (!nodes?.length) return [];
    return flattenPdfOutline(await resolvePdfOutline(doc, nodes));
  })();
  return outlinePromise;
};
```

同文件实现：

```ts
async function resolvePdfOutline(doc: PDFDocumentProxy, nodes: PdfOutlineNode[]): Promise<PdfOutlineNode[]> {
  const out: PdfOutlineNode[] = [];
  for (const node of nodes) {
    let page: number | undefined;
    try {
      const dest = typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
      if (Array.isArray(dest) && dest[0]) {
        page = (await doc.getPageIndex(dest[0] as RefProxy)) + 1;
      }
    } catch {
      /* broken destination: keep the title, no page */
    }
    out.push({ ...node, page, items: await resolvePdfOutline(doc, node.items ?? []) });
  }
  return out;
}
```

类型从 `pdfjs-dist` 导入 `PDFDocumentProxy`、`RefProxy`。清理时 `outlineRef.current = null`。

- [ ] **Step 5: 接线 EPUB 与 HTML**

`EpubReader` 增加 `outlineRef`，`book` 创建后：

```ts
const currentBook = book;
outlineRef.current = async () => {
  const navigation = await currentBook.loaded.navigation;
  return flattenEpubNav(navigation.toc).map((entry) => ({
    ...entry,
    action: entry.href ? () => rendition.display(entry.href!) : undefined,
  }));
};
```

`HtmlReader` 增加 `outlineRef`，在 `register()` 里：

```ts
outlineRef.current = async () => outlineEntriesFromHeadings(collectHeadings(container));
```

`HtmlReader` 从 `../panels/readerDom` 导入 `collectHeadings`。

- [ ] **Step 6: 改 `PanelContext`、`Reader`、`App`**

- `registry.ts` 增加 `outlineRef: MutableRefObject<OutlineExtractor | null>`。
- `Reader` props 增加 `outlineRef`，透传给三个 reader。
- `App` 增加 `const outlineRef = useRef<OutlineExtractor | null>(null);`，放进 `panelContext`，传给 `<Reader />`。

- [ ] **Step 7: 重写 `OutlinePanel`**

状态改为 `const [entries, setEntries] = useState<OutlineEntry[]>([]);` 和 `loading`。

加载顺序：
1. 等 `outlineRef.current`（最多 20×300ms），调用；非空则直接使用。
2. 为空且 `isPdf`：等 `structureRef.current`（最多 20×300ms），调用后把 `heading`/`title` 块转成 `OutlineEntry`（`title` level 1，其余 `Math.min(level || 2, 6)`），`page` 原样。
3. 为空且非 PDF：按现有 12×400ms 轮询 `collectHeadings(readerHostRef.current)`，再用 `outlineEntriesFromHeadings` 转换。

点击：

```ts
onShowOriginal();
requestAnimationFrame(() => requestAnimationFrame(() => {
  if (entry.action) void entry.action();
  else if (entry.page != null) scrollToPage(readerHostRef.current, entry.page);
  else if (entry.element) scrollToElement(entry.element);
}));
```

渲染：`outline-h${Math.min(entry.level, 6)}`，有 `page` 时右侧显示 `P{page}`；加载文字“正在读取大纲…”。空状态文案保持 PDF/非 PDF 两种。

- [ ] **Step 8: 验证测试与构建**

Run: `npm --prefix frontend run test -- outline.test`
Expected: 3 passed。

Run: `npm --prefix frontend run build`
Expected: 通过。

- [ ] **Step 9: 手动验证**

- 带书签 PDF：大纲条目与 PDF 阅读器书签一致，点击跳到对应页。
- 无书签 PDF：回退启发式标题，不触发“正在识别版面”。
- 把某个书签 dest 改成无效字符串：该条无页码但不崩溃，其他条目正常。
- EPUB：多章节目录完整，点击切换章节。
- Markdown/DOCX：标题大纲与之前一致。

- [ ] **Step 10: 提交**

```bash
git add frontend/src/outline.ts frontend/src/outline.test.ts frontend/src/panels/registry.ts frontend/src/panels/OutlinePanel.tsx frontend/src/readers/PdfReader.tsx frontend/src/readers/EpubReader.tsx frontend/src/readers/HtmlReader.tsx frontend/src/components/Reader.tsx frontend/src/App.tsx
git commit -m "feat: build outline from pdf bookmarks and epub toc"
```

---

### Task 10: 最终验证

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

1. 未放模型：阅读模式回退成功，有提示条，正文可读。
2. 放模型：显示“正在识别版面 x/y 页”，完成后单栏连续文章。
3. 双栏正文顺序正确，通栏标题/大图位置正确。
4. 页眉、页脚、页码不出现。
5. 图片/表格在正确段落之间，图注在图片下方且只出现一次。
6. 没有卡片、kind 标签、页码、逐块翻译按钮。
7. 点“翻译正文”后译文逐段出现在原文下方；关闭“译文”隐藏；再打开恢复。
8. A-/A+ 改字号，重启应用后保持。
9. 翻译失败只有该段显示重试，不影响其他段落。
10. 返回原始视图再进阅读模式不重复推理（缓存生效）。
11. 带书签 PDF 的大纲与书签一致；无书签 PDF 回退标题；EPUB 目录完整。

- [ ] **Step 3: 修复问题并复跑**

每修一个问题，复跑对应检查；最后再跑 Step 1。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: verify reading mode end to end"
```

---

## Self-Review Notes

- Spec §5 模型运行时 → Task 7；§6 PDF 抽取 → Task 7（几何/文字/顺序在 Task 4–6）；§7 图片 → Task 8；§8 阅读界面 → Task 3；§8A 大纲 → Task 9；§9 状态 → Task 3/7/9；§10 Rust → Task 1；§11 依赖 → Task 3/4/7；§12 测试 → 各任务 + Task 10。
- 图片最长边 1600px、caption 120px、字体 14–24px、置信度 0.3 都在任务里写死。
- 所有跨任务签名以各任务 `Interfaces` 为准；`TextItem`、`LayoutBox`、`ReadingStructureExtractor`、`OutlineEntry` 名称保持一致。
