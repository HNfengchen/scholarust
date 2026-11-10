# 阅读模式重做（Scholaread 风格）设计

日期：2026-11-09
状态：待确认
方案：A（前端 onnxruntime-web + DocLayout-YOLO 版面模型）

## 1. 为什么做

当前阅读模式是"调试视图"：每个块一张卡片，带头像标签、页码和"翻译此块"按钮；译文放在独立高亮框里；PDF 抽取只拿文字，图片全部丢失；分栏和段落切分靠启发式，效果不稳定。

目标是把阅读模式变成和 Scholaread（靠岸学术）一样的连续文章：单栏、有标题层级、没有卡片/标签/页码/逐块按钮，译文直接跟在原段落下，字号可调、译文可开关，图片和表格留在原来的相对位置。PdfReader 的原始分页视图（`mode === "original"`）保持不变。

## 2. 目标与非目标

### 目标

1. 阅读模式是连续单栏文章排版，而不是块卡片列表。
2. 标题、章节标题有字号层级；正文段落间距适合长文阅读。
3. 每个原段落下直接显示译文（弱化颜色，无边框、无背景块），全局"译文"开关控制显示/隐藏。
4. 阅读工具栏提供字号 A-/A+，设置持久化到 localStorage。
5. PDF 中的图片、表格、公式以图片形式保留在阅读顺序中的相对位置，并带图注。
6. PDF 版式由 DocLayout-YOLO（ONNX）识别；没有模型时回退到现有启发式抽取，并给出明确提示。
7. HTML/EPUB/Markdown 的图片也按顺序进入阅读模式。
8. 不改原始阅读器；不改翻译服务；不引入 OCR。

### 非目标

- 扫描版 PDF 的 OCR（没有文字层就仍然没有文字）。
- 表格结构识别、公式识别/转 LaTeX；表格和公式按图片保留。
- 进入阅读模式自动翻译（会产生 API 费用），仍由"翻译正文"按钮触发。
- 深色模式、划线/笔记、AI 摘要、图片缩放查看器。
- 模型自动下载；v1 由用户手动放到 `models/layout/`。
- GPU/WebGPU 推理；先用 WASM 单线程。
- 后端 Rust 原生 ONNX（方案 C，已放弃）。

## 3. 可选方案与选择

**方案 A：前端 onnxruntime-web + DocLayout-YOLO（选中）**
- 模型推理在 WebView2 里跑，页面已经由 pdf.js 渲染成 canvas，直接复用像素，不需要新增 Rust 推理依赖或分发 DLL。
- 75MB 模型只作为普通文件读取；失败可以回退启发式。
- 代价：首次加载模型和每页推理有 1–3 秒开销；WASM 单线程。

**方案 B：Rust 原生 `ort` + ONNX**
- 推理更快、可复用系统内存，但要处理 ORT DLL 打包、模型路径、跨 IPC 传图和错误传播；对当前需求收益不大。

**方案 C：只改进现有启发式（不引入模型）**
- 改动最小，但分栏、图文混排、页眉页脚仍然靠猜，达不到用户要的稳定抽取效果。

选 A：复用现有渲染管线，隔离在 frontend，回退路径简单。

## 4. 总体结构

```
pdf.js 渲染页 canvas (scale 2)
        │
        ├── 缩放到 1024×1024 letterbox ──► onnxruntime-web ──► [1,300,6] boxes
        │                                                        │
        └── 原尺寸 page canvas ◄──── 坐标映射 ◄──────────────────┘
                    │
        ┌───────────┴────────────┐
        │                        │
   文字/标题/图注区域         图片/表格/公式区域
   （分配 pdf.js text items）   （从 page canvas 裁剪成 data URL）
        │                        │
        └──────── XY-cut 阅读顺序 ────────┘
                    │
             DocumentStructure
                    │
              ReadingView（连续文章）
```

新增文件：

```
frontend/src/layout/
  model.ts        # ORT session 单例、预处理、推理、输出解析
  pdfLayout.ts    # 逐页编排：渲染、推理、文字分配、裁剪、组装
  order.ts        # XY-cut 阅读顺序 + 纯函数（可测试）
  types.ts        # 模型常量、区域类型
frontend/src/layout/*.test.ts
```

修改文件：

- `frontend/src/structure.ts`：`BlockKind` 增加 `figure`；`StructuredBlock` 增加 `image` / `caption`；新增 `extractPdfStructureWithLayout`；HTML/EPUB 抽取补图片；`DocumentStructure` 增加可选 `notice`。
- `frontend/src/readers/PdfReader.tsx`：新增 `readingStructureRef` 和 `outlineRef`。`readingStructureRef` 只在进入阅读模式时走版面抽取；`outlineRef` 优先用 PDF 内嵌书签（`doc.getOutline()`）并解析目标页，没有书签或解析失败时回退现有启发式，避免点开大纲触发全量推理。
- `frontend/src/App.tsx`：抽取进度状态；阅读缓存已经存在，继续复用。
- `frontend/src/components/ReadingView.tsx`：整页重写。
- `frontend/src/styles.css`：删除卡片式阅读样式，新增文章排版。
- `frontend/src/types.ts`：如需阅读设置类型。
- `app/src/commands.rs`、`app/src/lib.rs`、`app/src/model.rs`：新增模型路径/存在性命令，并允许 asset 访问。
- `frontend/package.json`、`vite.config.ts`：新增 `onnxruntime-web`、`vite-plugin-static-copy`、`vitest`。
- `README.md`：模型下载说明。
- `.gitignore`：确认 `models/` 已忽略。

## 5. 模型与运行时

模型固定为：

```
models/layout/doclayout_yolo_docstructbench_imgsz1024.onnx
```

下载来源（README 写清楚，含国内镜像）：

```
https://hf-mirror.com/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx
```

- 输入：`images`，`[1,3,1024,1024]` float32，RGB 0–1。
- 预处理：等比缩放到 1024 内，右下补 114/255 灰边（letterbox），记录缩放和偏移。
- 输出：`output0`，`[1,300,6]`，即 `x1,y1,x2,y2,confidence,class_id`；模型已做 NMS。
- 置信度阈值 0.3。
- 类别映射：

| id | 模型类别 | 处理 |
|----|----------|------|
| 0 | title | 标题块 |
| 1 | plain text | 正文区域 |
| 2 | abandon | 丢弃（页眉/页脚/页码） |
| 3 | figure | 裁剪为图片块 |
| 4 | figure_caption | 图注文字块 |
| 5 | table | 裁剪为图片块 |
| 6 | table_caption | 表注文字块 |
| 7 | table_footnote | 表注文字块 |
| 8 | isolate_formula | 裁剪为图片块 |
| 9 | formula_caption | 公式注文字块 |

运行时：

- `onnxruntime-web` 用 WASM；`ort.env.wasm.numThreads = 1`，避免 SharedArrayBuffer/跨源隔离要求；`ort.env.wasm.proxy = true` 把推理放到 ORT 自带 worker，避免每页 1–3 秒冻结主线程。代理模式下换文档只能丢弃结果，不能中止推理（可接受）。
- wasm/mjs 资源用 `vite-plugin-static-copy` 复制到 `ort/`，`ort.env.wasm.wasmPaths = '/ort/'`，dev 和 build 都可用。
- session 全局单例，第一次进入阅读模式时创建；创建失败抛出可识别错误。
- 模型 URL：Rust 命令 `layout_model_info` 返回 `{ path, exists }`；存在时对模型文件调用 asset scope `allow_file`，前端用 `convertFileSrc(path)` 交给 `InferenceSession.create`。
- 没有模型：不报错，回退 `extractPdfStructure(doc)`，并在 `DocumentStructure.notice` 写明"未找到版面模型，已使用简化抽取；将模型放到 …"。

## 6. PDF 版面抽取

### 6.1 逐页流程

1. `doc.getPage(n)`，计算 `scale = max(2, 1024 / viewport.width)`，限制渲染后最长边 ≤ 3200，避免超大页面内存爆掉。
2. 渲染到离屏 canvas；同时取 `page.getTextContent()`。
3. 用页面 canvas 生成 1024×1024 letterbox 输入：
   - 创建 1024×1024 canvas，填 `rgb(114,114,114)`；
   - 等比 `drawImage` 居中/左上（与训练一致，左上放置 + 右下补边）；
   - `getImageData` → `Float32Array`，RGB/255，CHW 排列。
4. 推理，得到 boxes；过滤 `confidence < 0.3`；把 letterbox 坐标反算回页面 canvas 像素坐标。
5. 文字分配：每个 pdf.js text item 用其中心点判断属于哪个区域。优先级：`title` > `plain text` > caption 类；`abandon` 区域内的 item 直接丢弃；每个 item 只分配一次。
6. 没有被任何区域覆盖的 item 不能丢：按现有 `collectPdfLines` 的方式聚成行，作为"补漏块"放在该页末尾，`kind` 按字号/位置判断。
7. 图片区域：从页面 canvas 按 box 加 8px padding 裁剪，`toDataURL("image/png")` 生成图片块；`figure` 用 JPEG 0.92 减小体积，`table`/`isolate_formula` 用 PNG 保证文字清晰。
8. 区域顺序用 XY-cut（见 6.3）；文字区域内再按行 y、x 排序。
9. 组装本页 blocks，附 `page = n`。

### 6.2 区域内分段

DocLayout-YOLO 的 `plain text` 可能是一整段、也可能是整栏，不能直接当一段。对每个文字区域：

- 用现有 `collectPdfLines` 的行聚合逻辑（按 y 聚类、按 x 排序）。
- 行间距 > 1.45 × 行高，或首行有明显缩进（x 比区域左边大 > 1.5em）时另起一段。
- 行尾是句末标点（`.!?。！？:：`）且下一行首字母大写/中文，不强制分段；宁可少分，不把一句话拆开。
- 标题区域：按 pdf.js 字号相对正文中位字号分级：≥1.6× → 一级（title），≥1.25× → 二级（h2），否则 h3。结合现有 `sectionForHeading` 跟踪 abstract/references/notes 状态。
- caption 区域：先尝试挂到最近的图片/表格块（同页、水平有重叠、垂直距离 ≤ 120px，不论在图上方还是下方）；挂上后不再单独生成文字块。找不到匹配时才作为独立 `caption` 块。
- 纯文字块合并：相邻 `paragraph` 且上一块没有句末标点、下一块以小写字母/中文继续时合并（跨页同理），减少分页造成的断段。

### 6.3 阅读顺序（XY-cut）

递归函数 `orderBoxes(boxes)`：

1. 若 boxes ≤ 1，直接返回。
2. 在 x 方向找最大空白间隙（投影后无 box 覆盖的列区间）；若间隙宽度 ≥ 页面宽度的 4% 且两侧都有 box，按 x 切成左右两组，先左后右递归。
3. 否则在 y 方向找最大空白间隙；≥ 页面高度的 3% 时切成上下两组，先上后下递归。
4. 都没有明显间隙：按 `(y, x)` 排序。
5. 同组内保持稳定顺序。

这能处理双栏正文、通栏标题、跨栏大图。纯函数放 `order.ts`，用 Vitest 覆盖：双栏、单栏、通栏标题、上下混排。

### 6.4 标题与特殊区块

- 标题只有一个来源：版面抽取出的 `title` 块。阅读正文用该块渲染 `<h1>`；工具栏标题用 `activeDoc.title`（文件名/元数据），两者不互相替换。
- 没有 `title` 块时正文直接从第一个内容块开始，不用文件名凭空插入 `<h1>`。
- `abandon` 区域内文字全部丢弃（页眉页脚、页码、水印）。
- `references` 之后的内容仍按现有 `kindForLine` 归为 `references`，阅读模式弱化显示。
- `figure` / `table` / `isolate_formula` 的图片块 `kind = "figure"`，`caption` 按 6.2 的规则挂接；图片块自身不编造图注。

## 7. HTML / EPUB / Markdown 图片

现有 HTML 抽取按选择器收集块；增加：

- `img`：生成 `figure` 块，`caption = img.alt || undefined`。
- `figure`：如果内部有 `img`，生成图片块；`figcaption` 文本作为 `caption`，不要重复生成文字块。
- 保持 DOM 顺序；图片块不参与翻译（`CONTENT_KINDS` 不含 `figure`）。
- 所有图片在抽取阶段统一转成 data URL，保证结果不依赖 reader 是否还挂着、缓存在切换文档后仍然有效：
  - EPUB 的 blob URL：`fetch(blobUrl)` → `createImageBitmap` → 画到 canvas（最长边 ≤ 1600px）→ `toDataURL("image/jpeg", 0.92)`；SVG/GIF 等光栅化失败时退回原始 blob 的 base64。
  - Markdown/HTML 的相对路径：新增 Rust 命令 `read_document_image(doc_id, src)`，按文档所在目录解析、做路径包含校验（canonical path 必须仍在文档目录下），读取后返回 data URL。绝对 `http(s)`/`data:` URL 原样保留。
  - 图片最长边统一限制 1600px，控制 ReadingCache 内存。
- HTML/Markdown 的图片路径问题在 Rust 侧解决，不放宽整个 asset scope。

## 8. 阅读界面

`ReadingView` 结构：

```
<div class="reading">
  <div class="reading-toolbar">           // sticky，半透明背景
    <div class="reading-toolbar-title">文档标题</div>
    <div class="reading-toolbar-actions">
      <button>A-</button><span>17</span><button>A+</button>
      <label><input type="checkbox" /> 译文</label>
      <button>翻译正文</button>
    </div>
  </div>
  <article class="reading-article">
    <h1>...</h1>
    <p>原文</p>
    <div class="reading-translation">译文</div>
    <h2>...</h2>
    <p>...</p>
    <figure class="reading-figure"><img /><figcaption /></figure>
  </article>
</div>
```

规则：

- 文章宽度 `max-width: 46rem`（约 68–72 字符），居中，左右留白。
- 字体：正文 17px 起，行高 1.85；标题用同一字体族，字重和字号区分。
- 段落：`margin: 0 0 1.4em`；首行不缩进（网页阅读习惯）。
- 译文：紧跟原段落，`color: var(--muted)`，`font-size: .95em`，`margin-top: .45em`；无背景、无边框；可加很淡的左边线（1px，可选），不形成卡片。
- 图片：`max-width: 100%`，居中，`margin: 1.8em auto`；图注小字灰色居中。
- 不再显示：kind 标签、页码、每块翻译按钮、块边框。
- 翻译错误：仅在对应段落下方显示一行"翻译失败，重试"文字按钮；不打断排版。
- 译文开关：勾选显示所有已完成的译文；关闭时全部隐藏。
- 字号：范围 14–24px，步长 1px；设置写 `localStorage`：
  - `scholarust.reading.fontSize`
  - `scholarust.reading.showTranslation`
- "翻译正文"：沿用现有 `translateContent`（3 并发、只翻 `CONTENT_KINDS`）；按钮显示进度 `翻译中 3/20`；完成后自动打开译文开关。
- 加载态：抽取阶段显示 `正在识别版面… 3/12 页`；翻译阶段复用现有状态。
- `DocumentStructure.notice` 存在时，工具栏下方显示一条可关闭的浅色提示条。

## 8A. 大纲面板

- PDF：优先 `doc.getOutline()`，递归保留层级，`dest` 解析成 1-based 页码；内嵌书签为空或目标页全部无效时回退 `extractPdfStructure` 的标题块。
- EPUB：优先 `book.loaded.navigation` 的 `toc`，点击调用 `rendition.display(href)`；没有目录时回退 DOM 标题。
- HTML/DOCX/Markdown：继续用 DOM `h1..h6`，但统一进 `OutlineEntry`。
- `OutlinePanel` 只消费 `OutlineEntry`；点击优先级 `action` → `page` → `element`。
- 打开大纲不触发版面模型；PDF 没有书签时最多等 `structureRef`（启发式），不启动 ONNX。
- 空状态：PDF 显示“未检测到标题，可能为扫描版 PDF”，其他显示“未检测到标题”。

## 9. 状态与数据流

`App.tsx`：

- 新增 `extractProgress: { done: number; total: number } | null`，传给 ReadingView。
- 新增 `readingStructureRef`：只在 `startReading()` 时调用；签名 `(onProgress?: (done, total) => void) => Promise<DocumentStructure>`。现有 `structureRef` 保持启发式，作为大纲的回退来源。
- 新增 `outlineRef`：大纲优先读取阅读器自己的目录，不触发 ONNX 推理。PDF 用 `doc.getOutline()`，EPUB 用 `book.loaded.navigation`，HTML/DOCX/Markdown 用 DOM 标题；结果统一成 `OutlineEntry { id, text, level, page?, href?, element?, action? }`。
- `startReading()` 仍然把 `structure` 和 `translations` 缓存进 `ReadingCache`；图片 data URL 一起缓存（同一文档再次进入不重复推理）。
- 切换文档时清空进度。
- 翻译缓存键仍用 `block.id`（保持 `number`）。版面抽取按阅读顺序生成从 1 开始的连续数字 id，不改类型；重新抽取时同时清空该文档的译文，避免旧译文错位。
- 文档移除时删除对应 `readingCache`（现有逻辑），data URL 随之释放。

`PdfReader.tsx`：

```ts
readingStructureRef.current = async (onProgress) => {
  const info = await invoke<LayoutModelInfo>("layout_model_info");
  if (!info.exists) {
    return { ...(await extractPdfStructure(doc)), notice: "..." };
  }
  try {
    return await extractPdfStructureWithLayout(doc, { modelUrl: convertFileSrc(info.path), onProgress });
  } catch (e) {
    console.warn("layout extraction failed", e);
    return { ...(await extractPdfStructure(doc)), notice: "版面模型运行失败，已使用简化抽取" };
  }
};
```

## 10. Rust 改动

`model.rs`：

```rust
pub fn layout_model_path(&self) -> PathBuf {
    self.models_dir.join("layout").join("doclayout_yolo_docstructbench_imgsz1024.onnx")
}
```

`commands.rs`：

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutModelInfo { pub path: String, pub exists: bool }

#[tauri::command]
pub async fn layout_model_info(app: AppHandle, state: State<'_, AppState>) -> Result<LayoutModelInfo, String> {
    let path = state.model.layout_model_path();
    if path.is_file() {
        app.asset_protocol_scope().allow_file(&path).map_err(err)?;
    }
    Ok(LayoutModelInfo { path: path.to_string_lossy().into_owned(), exists: path.is_file() })
}

#[tauri::command]
pub async fn read_document_image(state: State<'_, AppState>, id: String, src: String) -> Result<String, String> {
    let library = state.library.lock().await;
    let doc = library.get(&id).ok_or_else(|| format!("document not found: {id}"))?;
    let base = Path::new(&doc.path).parent().ok_or("document has no parent directory")?;
    let base = base.canonicalize().map_err(err)?;
    // 前端先 decodeURIComponent 并去掉 ?/#，这里只处理文件路径
    let path = base.join(&src).canonicalize().map_err(err)?;
    if !path.starts_with(&base) {
        return Err("image path escapes document directory".into());
    }
    let bytes = std::fs::read(&path).map_err(err)?;
    let mime = match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    };
    use base64::Engine;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}
```

`lib.rs` 注册 `commands::layout_model_info`、`commands::read_document_image`。新增 Rust 依赖 `base64 = "0.22"`。

## 11. 依赖与构建

- `onnxruntime-web`：`^1.20.0`（运行时）。
- `vite-plugin-static-copy`：devDependency，把 `onnxruntime-web/dist/*.{wasm,mjs}` 复制到 `ort/`。
- `vitest`：devDependency，跑 `order.ts` / 坐标映射的纯函数测试；`package.json` 增加 `"test": "vitest run"`。
- Rust：`base64 = "0.22"`（`app/Cargo.toml`），用于把文档目录内的图片读成 data URL。
- Vite 配置：

```ts
ort.env.wasm.wasmPaths = "/ort/";
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = true; // 推理在 ORT worker 内执行，主线程不冻结
```

- 打包：模型不进安装包；`models/` 继续 gitignore。

## 12. 测试与验收

### 自动测试

- `order.ts`：双栏、单栏、通栏标题、上下混排的顺序。
- letterbox：缩放/偏移/反算坐标的往返误差 < 1px。
- 文字分配：item 中心落在框内、框外补漏、abandon 丢弃。
- caption 挂接：最近的图/表才挂，挂上后不再生成独立块；无匹配时保留独立块。
- 标题：有 title 块时只生成一个 h1；无 title 块时正文不凭空插标题。
- `npm run build`（`tsc --noEmit && vite build`）通过。
- `npm run test` 通过。

### 手动验收

准备：一篇双栏带图的英文 PDF、一篇中文 PDF、一篇 EPUB/Markdown 带图。

1. 未放模型时进入阅读模式：回退成功，出现提示条，正文可读。
2. 放入模型后进入：显示"正在识别版面 x/y 页"；完成后是单栏连续文章。
3. 双栏正文顺序正确；通栏标题/大图位置正确。
4. 页眉、页脚、页码不出现。
5. 图片和表格出现在正确段落之间，图注在图片下方。
6. 没有卡片、kind 标签、页码、逐块翻译按钮。
7. 点"翻译正文"后译文逐段出现在原文下方；关闭"译文"全部隐藏；再打开恢复。
8. A-/A+ 改变字号，重启应用后保持。
9. 翻译失败时只有该段显示重试，不影响其他段落。
10. 返回原始视图再进阅读模式，不重复推理（使用缓存）。

## 13. 风险与对策

| 风险 | 对策 |
|------|------|
| 模型对中文/特殊版式误判 | 置信度阈值 + 未覆盖文字补漏；整页失败时回退启发式 |
| WASM 推理慢（1–3s/页） | `wasm.proxy = true` 放 worker，主线程可滚动；串行 + 进度条；session 复用；结构缓存 |
| 75MB 模型下载门槛 | README 给 hf-mirror 链接；缺失时明确提示并回退 |
| 图片 data URL 占内存 | 统一最长边 1600px + JPEG/PNG 压缩；随 ReadingCache 释放；不缓存原始页 canvas |
| EPUB blob URL 在 reader 卸载后失效 | 抽取时就转 data URL，不把 blob URL 放进缓存 |
| Markdown 相对图片路径 404 | `read_document_image` 按文档目录解析，canonical path 必须仍在目录内 |
| 双栏顺序仍错 | XY-cut 纯函数测试 + 实际 PDF 验收；必要时按栏内 y 排序兜底 |
| ORT wasm/worker 资源路径在打包后失效 | 静态复制 `wasm` 和 `mjs` 到 `ort/`；dev/build 同一路径；构建后人工验证一次 |
| WebView2 不支持某些 wasm 特性 | 单线程、SIMD 可选；失败回退启发式 |

## 14. 实施顺序

1. Rust：模型路径命令 + 图片 data URL 命令 + asset 放行 + README 下载说明。
2. 前端依赖与 ORT 资源接线；`layout/model.ts` 跑通单页推理（先用固定测试图验证输出）。
3. `order.ts` + 单测。
4. `pdfLayout.ts`：逐页文字分配、图片裁剪、caption 挂接、组装；接进 PdfReader，带回退。
5. `structure.ts` 类型扩展 + HTML/EPUB/Markdown 图片。
6. `ReadingView` 重写 + 样式 + 字号/译文持久化。
7. 手动验收 + 构建/测试。

## 15. 留给实现者的决定

- ORT 具体版本与 wasm/mjs 文件名以安装后的 `onnxruntime-web/dist` 为准。
- 段落合并标点集合的细节。
- 工具栏在窄窗口下的换行方式。
- 模型输出 `[1,300,6]` 与 NMS 行为：拿到模型后先跑一页确认，再写解析代码。
