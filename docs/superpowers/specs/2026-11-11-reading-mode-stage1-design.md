# 阅读模式重做 · Stage 1 设计（Scholaread 风格 + 无损抽取）

日期：2026-11-11
状态：设计完成（取代 `2026-11-09-reading-mode-scholaread-design.md`，该文原方案 A 的模型部分移入 Stage 2 文档）
关联：Stage 2（可选的 Rust ONNX 版面模型）→ `docs/superpowers/specs/2026-11-11-layout-model-stage-design.md`

## 1. 背景

当前阅读模式是"调试视图"：每块一张卡片，带标签、页码、"翻译此块"按钮；译文在独立高亮框里；PDF 抽取靠启发式，**会误删正文、参考文献被合并成乱序的一段、图片全部丢失**；阅读器还会把每一页都渲染成 canvas + TextLayer，长文档很慢。

目标：阅读模式变成 Scholaread（靠岸学术）式的连续文章——单栏、有标题层级、无卡片/标签/页码/逐块按钮，译文直接跟在原段落下，字号可调、译文可开关，图片留在原来的相对位置。

## 2. 阶段划分

| | Stage 1（本次实施） | Stage 2（单独设计，暂不做） |
|---|---|---|
| 抽取来源 | pdf.js 文本层坐标 + PDF 书签 | + ONNX 版面模型（Rust `ort`） |
| 速度 | 毫秒~秒级，不卡 UI | 每页 0.3–0.6 s |
| 内容 | **文本层全量保留，一个字都不丢** | 同左 |
| 双栏顺序 | XY-cut + 通栏处理 | 同左 + 模型校正 |
| 参考文献 | 逐条成块 + 按编号排序 | 同左 |
| 图片 | 仅嵌入位图（operator list 直取，带位置） | 位图 + 矢量图/表格/公式（模型框裁剪） |
| 依赖 | 纯前端 + vitest | Rust `ort` + onnxruntime |

Stage 1 是 Stage 2 的**前提**：Stage 2 只替换"区域识别"这一步，其余逻辑全部复用。

## 3. 目标与非目标

### 目标

1. 阅读模式是连续单栏文章排版，不是块卡片列表。
2. 标题、章节标题有字号层级；正文段落适合长文阅读。
3. 每个原段落下直接显示译文（弱化颜色，无背景块），全局"译文"开关控制显隐。
4. 工具栏提供字号 A-/A+，持久化到 localStorage。
5. PDF 图片按原位置保留在阅读顺序中，带图注。
6. **抽取零丢失**：PDF 文本层里的每个字符都必须落到某个块里。
7. 双栏 PDF 按"左栏读完再右栏"排序，通栏标题/大图位置正确。
8. 参考文献按条目逐条呈现，并按编号排序。
9. 大纲优先使用 PDF 内嵌书签，标题层级与页码更准。
10. HTML/EPUB/Markdown 的图片按顺序进入阅读模式。

### 非目标

- 扫描版 PDF 的 OCR。
- 表格结构识别、公式转 LaTeX（表格/公式整体当图片处理）。
- 矢量插图抽取（Stage 1 不支持，Stage 2 解决）。
- 进入阅读模式自动翻译（仍由"翻译正文"按钮触发，避免 API 费用）。
- 深色模式、划线/笔记、AI 摘要、图片缩放查看器。
- 模型自动下载；Stage 2 的模型由用户手动放到 `models/layout/`。

## 4. 方案取舍（为什么不再用浏览器 ONNX）

初版方案是"前端 onnxruntime-web + DocLayout-YOLO"。评估后放弃，理由：

1. **慢的根源不在模型**：阅读器一次性渲染所有页（`PdfReader.tsx:47-84`），以及模型每页 1–3 s 的 WASM 推理（且跑在 UI 线程上）。
2. **模型不解决丢字**：DocLayout-YOLO 只给矩形；按框分配文字时"没落进任何框的文字"就会被丢掉——丢字风险来自抽取算法，不来自后端。
3. **模型不解决参考文献乱**：那是切分问题（悬挂缩进没被当成条目边界）。
4. **文本坐标本来就有**：pdf.js 的 `getTextContent()` 已经给出每个 item 的坐标，双栏切分、段落合并、参考文献条目都不需要模型。
5. WASM 单线程推理会冻结界面，而 Stage 1 全程无阻塞。

因此 Stage 1 用"文本层坐标 + 规则"做无损抽取，把模型留作 Stage 2 的可选增强（见关联文档）。

## 5. Stage 1 抽取管线

### 5.1 文本层与坐标

- `page.getTextContent()` → items：`str`、`transform = [a,b,c,d,e,f]`、`width`。
- 以 `viewport = page.getViewport({ scale: 1 })` 建立页面坐标系（原点左上、y 向下）：
  - `x = transform[4]`
  - `baseline = viewport.height - transform[5]`
  - `size = Math.abs(transform[3])`（水平文本即字号；异常值退回 `item.height`）
  - `width = item.width`
- 空 `str` 的 item 直接丢弃（不算内容）。

### 5.2 行聚合

- 按 `baseline` 聚类：与当前行基线差 ≤ `max(1, size * 0.35)` 归入同一行。
- 行内按 `x` 升序；相邻 item 间隙 > `0.25 * size` 时补一个空格，否则直接拼接（pdf.js 多数已含空格，避免出现"文 字"）。
- 行记录：`{ x, baseline, width, size, text }`；行宽 = 最右 item 右边界 - 最左 item 左边界。

### 5.3 双栏检测与阅读顺序

**在 item 级做分栏，行在分栏之后才聚合**——否则同一基线上的左右两栏文字会被并成一条"通栏"行，既破坏栏检测，也让段落合并出错。

分栏检测 `detectGutter(items, pageWidth, pageHeight, bodySize)`：

1. 只取正文带内的 item：`baseline` 落在 `[0.08 * pageHeight, 0.92 * pageHeight]`（排除页眉页脚带）。
2. 对这些 item 的 x 区间 `[x, x + width]` 做投影合并，得到空白间隙。
3. 候选间隙按宽度从大到小；**判定阈值** `gap >= max(0.02 * pageWidth, 1.2 * bodySize)`——栏间距通常只有页宽的 2–4%，用页宽比例做阈值会漏判。
4. 对每个候选间隙 `[g0, g1]`，统计"横跨"该间隙的正文 item（`x < g1 && x + width > g0`）：居中标题、跨栏大图的标题文字会横跨。若横跨 item 数量 ≤ 正文 item 数的 25%，接受该间隙为栏缝，并把横跨 item 标记为**通栏元素**；否则换下一个候选。
5. 没有合格间隙 → 单栏。

阅读顺序 `orderPageLines(items, pageWidth, pageHeight, bodySize)`：

1. 单栏：所有 item 聚成行后按 `(baseline, x)` 排序。
2. 双栏：
   - 左栏 item：`x + width <= g0`；右栏 item：`x >= g1`；其余为通栏 item。
   - 各自聚成行。
   - 输出顺序 = **通栏行与左栏行按 `baseline` 归并**（页首标题因此排在最前；页中跨栏大图落在左栏同高度位置），**再整体接上右栏行**。
3. 图片矩形参与同一遍排序（见 5.8），通栏大图按 `y` 插入归并序列。

纯函数放 `layout/order.ts`，必须覆盖：双栏、单栏、通栏标题、通栏大图、词间距不误判成栏缝。

### 5.4 段落合并

在**已排序的行序列**上做：

- 正文块字号 `bodySize` = 按字符数加权的众数（字号四舍五入到 0.5）。
- 新段条件（满足其一）：
  - 与上一行的垂直间隙 > `1.5 * prev.size`；
  - 上一行以句末标点结尾（`.!?。！？:：`）且当前行 `x` 比上一行缩进 > `1.5 * prev.size`；
  - 当前行是标题（见 5.5）；
  - 当前行是参考文献条目起始（见 5.7）；
  - 当前行是列表项起始（`^\s*([-•*]|\d+[.)])\s+`）。
- 行尾连字符：上一行以 `-` 结尾且当前行以小写字母开头 → 去掉连字符直接拼接。
- 合并后保留首行的 `x`、`baseline`、`size`。

### 5.5 标题识别

判定"像标题"（满足其一）：

- 字号 ≥ `bodySize * 1.6` → 一级；≥ `1.25` → 二级；≥ `1.1` 且长度 < 90 字符 → 三级。
- 编号模式：`^\d+(\.\d+)*[.、\s]`（层级取点数）、`^[一二三四五六七八九十]+[、.．]`、`^(Abstract|Introduction|Conclusion|References|摘要|引言|结论|参考文献)$`。
- 与 PDF 书签标题匹配（归一化：去空白、小写、去掉尾部标点）。

**书签校正**：PDF 书签（`doc.getOutline()`）给出权威标题与页码。标题候选与书签标题匹配时，采用书签的**层级**；书签有目标页时，标题块的 `page` 用书签页码。

### 5.6 页眉/页脚剔除（保守）

只有同时满足下列条件才丢弃一行，宁可留错不可丢字：

- 位于页面顶部 6% 或底部 6% 区域；
- 归一化文本在**至少 40% 的页面**上重复出现（页码除外）；
- 且该行是纯页码样式（`^\d+$`、`^\d+ / \d+$`、`^[-–—]\s*\d+\s*[-–—]$`、`^第\s*\d+\s*页$`）**或**与文档标题完全相同。

其他任何情况一律保留。`removedLines` 统计被丢弃行数。

### 5.7 参考文献

- **分节起点**：某行归一化后匹配 `^(references|参考文献|bibliography|works cited|literature cited|引用文献)$`；其后到下一个"标题级"行（字号 ≥ `bodySize*1.25`）之间的内容属于参考文献节。
- **条目切分**（节内）：
  - 条目起始行：匹配 `^\s*(\[\d+\]|\d+[.)]|\(\d+\))` **或** 该行 `x` 比节内正文左边界小 > `0.5 * bodySize`（悬挂缩进）；
  - 其余行是上一条目的续行，接在上一条目后面。
- **排序**：抽出条目首个编号（`[12]` → 12），按数字升序排列；无编号的条目保持原相对顺序排在最后。这修复双栏/跨页导致的乱序。
- 每个条目是一个块，`kind = "reference"`，块内保留原始编号文本（`[12] Author...`）。
- 阅读模式里参考文献弱化显示（小字、灰色），仍可翻译。

### 5.8 图片抽取（嵌入位图）

- `page.getOperatorList()`：扫描 `OPS.paintImageXObject` / `OPS.paintJpegXObject` / `OPS.paintInlineImageXObject`。
- 维护 CTM 栈：`OPS.save` 入栈、`OPS.restore` 出栈、`OPS.transform` 与当前矩阵相乘。
- 对每个图像对象计算摆放矩形：`w = hypot(a, b)`、`h = hypot(c, d)`、`x = e`、`y = f - h`（PDF 原点左下，翻转到页面坐标）。
- 像素来源：`page.objs.get(objId)`（必要时 `page.commonObjs.get(objId)`）拿 `{ width, height, data }`，其中 data 可能是 `ImageData` / `Uint8Array` / `ImageBitmap`。
- 绘制到离屏 canvas：按矩形尺寸绘制，最长边限制 1600px，`toDataURL("image/jpeg", 0.92)`。
- 图像矩形参与 5.3 的排序（作为矩形元素），因此图片出现在它周围的文字之间的正确位置。
- **限制**：`OPS.paintImageMaskedXObject`（带蒙版）、`paintImageXObjectRepeat`（平铺）、矢量图、表格线**不抽取**，统计跳过数量；这类内容由 Stage 2 的版面模型补齐。
- 图注：位图下方 120px 内、水平有重叠、且是独立文字行的文本块，挂在图片的 `caption` 上，不再单独成块。

### 5.9 组装

- 所有块按最终阅读顺序编号，`id` 从 1 连续递增（保持 `number` 类型，翻译缓存键不变）。
- `page` 为块所在页；`level` 标题层级，其余 0。
- `kind` 取值新增：`figure`、`reference`；沿用 `title|heading|abstract|paragraph|note|references|caption|meta`。
- 相邻 `paragraph` 跨页合并：上一块没有句末标点、下一块以小写字母或中文开头时合并，保留上一块的 `page`。

## 6. 阅读界面

结构：

```
<div class="reading">
  <div class="reading-toolbar">        // sticky
    <div class="reading-toolbar-title">文档标题</div>
    <div class="reading-toolbar-actions">
      <button>A-</button><span>17</span><button>A+</button>
      <label><input type="checkbox" /> 译文</label>
      <button>翻译正文</button>
    </div>
  </div>
  <article class="reading-article">
    <h1>标题</h1>
    <p>原文</p>
    <div class="reading-translation">译文</div>
    <figure class="reading-figure"><img /><figcaption /></figure>
    <p class="reading-reference">[12] Author...</p>
  </article>
</div>
```

规则：

- 文章宽度 `max-width: 46rem`（约 68–72 字符），居中。
- 正文 17px 起，行高 1.85；标题同字体族，用字号字重区分。
- 段落 `margin: 0 0 1.4em`，首行不缩进。
- 译文紧跟原段落：`color: var(--muted)`、`font-size: .95em`、`margin-top: .45em`，无背景块，仅 1px 淡左边线。
- 图片 `max-width: 100%` 居中，`margin: 1.8em auto`；图注小字灰色居中。
- 参考文献：小字（0.86em）、灰色、`word-break`。
- 不显示：kind 标签、页码、每块翻译按钮、块边框。
- 翻译错误：仅在对应段落下方显示一行"翻译失败，重试"文字按钮。
- 译文开关与字号持久化：`scholarust.reading.showTranslation`、`scholarust.reading.fontSize`（14–24，步长 1）。
- "翻译正文"沿用现有 `translateContent`（3 并发，只翻 `CONTENT_KINDS`），按钮显示 `翻译中 3/20`，完成后自动打开译文开关。
- `DocumentStructure.notice` 存在时，工具栏下方显示可关闭的浅色提示条（例如"本文档 3 张图为矢量图，未保留"）。

## 7. 大纲面板

- PDF：优先 `doc.getOutline()`，递归保留层级，`dest` 解析成 1-based 页码；书签为空或目标页全无效时回退 `extractPdfStructure` 的标题块。
- EPUB：优先 `book.loaded.navigation` 的 `toc`，点击 `rendition.display(href)`；无目录时回退 DOM 标题。
- HTML/DOCX/Markdown：DOM `h1..h6`。
- 统一为 `OutlineEntry { id, text, level, page?, href?, element?, action? }`；`OutlinePanel` 只消费它，点击优先级 `action` → `page` → `element`。
- 打开大纲**不触发**任何推理。
- 空状态：PDF"未检测到标题，可能为扫描版 PDF"，其他"未检测到标题"。

## 8. HTML / EPUB / Markdown 图片

- `img`：生成 `figure` 块，`caption = img.alt || undefined`。
- `figure`：内部有 `img` 时生成图片块，`figcaption` 作为 `caption`，不再重复生成文字块。
- 保持 DOM 顺序；图片块不参与翻译（`CONTENT_KINDS` 不含 `figure`）。
- 抽取阶段统一转 data URL，保证结果不依赖 reader 是否还挂着：
  - EPUB blob URL：`fetch` → `createImageBitmap` → canvas（最长边 ≤ 1600px）→ `toDataURL("image/jpeg", 0.92)`；光栅化失败退回原始 base64。
  - 相对路径（Markdown/HTML）：Rust 命令 `read_document_image(doc_id, src)` 按文档目录解析并做包含校验，返回 data URL。绝对 `http(s)`/`data:` 原样保留。
  - 路径取 `img.getAttribute("src")` 原始值（不能取 `img.src`，那已被解析成应用内 URL）。
- 图片最长边统一 1600px，控制 ReadingCache 内存。

## 9. 状态与数据流

`App.tsx`：

- 新增 `readingStructureRef`：只在 `startReading()` 调用，签名 `(onProgress?: (done, total) => void) => Promise<DocumentStructure>`；`structureRef` 保持现有启发式，作为大纲回退来源。
- `startReading()` 缓存 `structure` + `translations`；重新抽取时清空该文档译文，避免旧译文错位。
- 切换文档时清空抽取进度。

`PdfReader.tsx`：

```ts
readingStructureRef.current = async (onProgress) => {
  return extractPdfStructureFast(doc, { onProgress });
};
```

`Reader.tsx`：新增 `readingStructureRef` 与 `outlineRef` 两个 ref prop，透传给各 reader；非 PDF reader 的 `readingStructureRef` 指向同一个 HTML/EPUB 抽取函数。

## 10. Rust 改动

Stage 1 只需要两个命令（**已在 Task 1 实现**）：

- `layout_model_info` → `{ path, exists }`（Stage 2 用；Stage 1 不调用）。
- `read_document_image(id, src)` → data URL，路径包含校验（防止读到文档目录外的文件），配 `base64 = "0.22"`。
- `ModelManager::layout_model_path()` → `models_dir/layout/doclayout_yolo_docstructbench_imgsz1024.onnx`。

Stage 1 不引入 `ort`、`image` 等推理依赖。

## 11. 依赖与构建

- `vitest`：devDependency，`"test": "vitest run"`，`vitest.config.ts` 用 node 环境，include `src/**/*.test.ts`。
- 不引入 `onnxruntime-web` / `vite-plugin-static-copy`（留给 Stage 2）。
- `models/` 继续 gitignore。

## 12. 测试与验收

### 自动测试

- 行聚合：同一基线合并、左右顺序、跨基线不合并。
- XY-cut：双栏、通栏标题、单栏、通栏大图、上下混排。
- 段落合并：行距断段、缩进断段、连字符续行、列表项。
- 标题：字号分级、编号模式、书签匹配后采用书签层级。
- 页眉页脚：页码被剔除、正文重复首行不被误删。
- 参考文献：条目切分、编号排序、续行合并。
- 图片：CTM 矩形计算、排序插入位置。
- `npm run build`（`tsc --noEmit && vite build`）与 `npm run test` 通过。

### 手动验收

准备：一篇双栏带图的英文 PDF、一篇中文 PDF、一篇含 20+ 条参考文献的 PDF、一篇 EPUB、一篇带相对路径图片的 Markdown。

1. 进入阅读模式：无卡片、无 kind 标签、无页码、无逐块翻译按钮。
2. 双栏正文按"左栏读完再右栏"，通栏标题在最前。
3. 逐页核对：正文没有整段丢失（与原文比对）。
4. 参考文献逐条显示，并按编号排序。
5. 嵌入位图出现在正确段落之间，图注在图下且只出现一次。
6. 译文逐段出现在原文下方；开关可隐藏/恢复。
7. A-/A+ 改字号，重启后保持。
8. EPUB/Markdown 图片正常显示；相对路径图片不 404。
9. 返回原始视图再进阅读模式不重复抽取（缓存生效）。

## 13. 风险与对策

| 风险 | 对策 |
|------|------|
| 行/段启发式仍会误合并 | 宁可少合并不丢字；每条规则都有单测；用书签校正标题 |
| 悬挂缩进在部分排版里不存在 | 参考文献另用编号模式识别；无编号的条目按原顺序保留，不丢 |
| 矢量图/表格抽不出来 | Stage 1 明确跳过并提示；Stage 2 用版面模型补齐 |
| operator list 的 CTM 解析出错 | 只在能算出合法矩形时绘制；否则跳过并计数，不影响文字 |
| 图片 data URL 占内存 | 最长边 1600px + JPEG 0.92；随 ReadingCache 释放 |
| 保留页眉页脚 | 只用页边 6% + 重复 + 页码样式三重条件，宁可留错 |
| `getTextContent()` 对大文件慢 | 逐页取、可取消；文本层解析比渲染快一个数量级 |

## 14. 实施顺序

1. Rust 命令（Task 1，已完成）。
2. 结构类型扩展（`figure`/`reference`/`caption`/`notice`）。
3. 阅读界面重写 + 样式 + 字号/译文持久化。
4. 文本层坐标与行聚合。
5. XY-cut 排序（含通栏）。
6. 段落合并与标题识别。
7. 参考文献分段与排序。
8. 图片抽取（位图）。
9. 抽取编排与接入（PdfReader/Reader/App）。
10. 大纲面板（书签优先）。
11. HTML/EPUB/Markdown 图片。
12. 最终验证。

## 15. 留给实现者的决定

- 句末标点集合与标题编号模式的具体正则。
- `bodySize` 众数的加权细节（建议按字符数加权，字号取 0.5 的倍数）。
- operator list 中 `paintInlineImageXObject` 的数据来源处理方式。
- 工具栏在窄窗口下的换行方式。
