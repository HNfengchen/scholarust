# Stage 2 设计：Rust ONNX 版面模型（可选开关）

日期：2026-11-11
状态：设计完成，**不在当前实施计划内**（Stage 1 完成后另立计划）
关联：主设计 `docs/superpowers/specs/2026-11-11-reading-mode-stage1-design.md`

## 1. 定位

Stage 1（当前实施）用 pdf.js 文本层坐标 + XY-cut + 悬挂缩进切分，特点：**快、零丢失、纯前端**。它的短板只有一处：

- 只能保留 **嵌入位图**（通过 PDF operator list 直接取图像对象与摆放矩形）。
- **矢量图/表格/公式**没有可抽取的对象，Stage 1 会跳过它们。

Stage 2 引入版面模型（DocLayout-YOLO ONNX），只为解决这一条：**给出"图/表/公式"区域的矩形**，从而把矢量图也按原位置裁成图片。同时它也能在复杂版式（多栏嵌套、跨栏大图）上校正 Stage 1 的顺序。

Stage 2 不替换 Stage 1 的任何其他逻辑：段落合并、标题识别、参考文献逐条成块、译文内联排版全部复用。

## 2. 为什么是 Rust 而不是浏览器 WASM

| | 浏览器 onnxruntime-web | Rust `ort` |
|---|---|---|
| 推理耗时（1024×1024，DocLayout-YOLO） | 0.5–2 s/页 | 0.1–0.4 s/页 |
| 是否阻塞 UI | WASM 单线程会冻结；`proxy=true` 缓解 | 不阻塞，Rust 侧后台线程 |
| 部署 | 需在 Vite 里复制 wasm/mjs | 需随包分发 onnxruntime 动态库 |

代价：Rust 侧多一层 IPC 和二进制分发。用户明确要求"模型这部分单独成文档"，Stage 2 才做，且默认关闭。

## 3. 架构

```
pdf.js: page.render(scale → 长边 1024) → canvas.toBlob("image/png")
        │  PNG 字节（每页 ~200–800KB）
        ▼
Tauri IPC: detect_layout(png: Vec<u8>) -> Vec<Detection>
        │  Rust: PNG 解码(image) → letterbox 1024 → CHW f32
        │        ort: Session.run → output0 [1,300,6] → 解析/反算
        ▼
前端: 检测框 → 与文本行合并 → Stage 1 的 XY-cut/段落/参考文献逻辑
        │
        ▼
   DocumentStructure
```

**为什么 PNG 而不是直接把像素给 Rust**：pdf.js 在前端渲染最快且已经在用；Rust 侧只需解码 PNG，不引入 PDF 解析依赖（避免 pdfium 的 C++ 构建负担）。代价是每页几百 KB 的 IPC 传输和一次 PNG 解码（约 100 ms）。

**为什么不把渲染也放 Rust**：pdfium-render 等 Rust PDF 渲染库需要编译 C++ 依赖，构建慢、跨平台麻烦，而 pdf.js 已经在用。

## 4. 依赖与分发

```toml
# app/Cargo.toml
ort = { version = "2.0.0-rc.15", features = ["download-binaries"] }
image = { version = "0.25", default-features = false, features = ["png"] }
ndarray = "0.16"
```

- `ort` 的 `download-binaries` 特性在构建时下载并缓存 ONNX Runtime 动态库，**免去手工打包各平台二进制**；离线环境可切换为 `load-dynamic` + 手动放置。
- ONNX Runtime 许可 MIT，模型权重 Apache-2.0，与本项目 AGPL-3.0 兼容。
- 模型文件不进安装包，仍放 `models/layout/doclayout_yolo_docstructbench_imgsz1024.onnx`（路径解析复用已实现的 `ModelManager::layout_model_path`）。

## 5. 新增命令

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub x: f32, pub y: f32, pub w: f32, pub h: f32, // 页面像素坐标
    pub confidence: f32,
    pub class_id: u32,
}

#[tauri::command]
pub async fn detect_layout(state: State<'_, AppState>, png: Vec<u8>) -> Result<Vec<Detection>, String>
```

- Rust 命令体是同步计算，必须 `tokio::task::spawn_blocking` 包住，避免占住异步运行时线程。
- 输入 PNG 已是 1024 letterbox 好的图时，Rust 侧只需解码 + 转 CHW；若前端已按 1024 渲染并自己 letterbox，则 Rust 不再缩放，只做归一化（更省一次重采样）。
- 模型缺失时返回明确错误字符串，前端据此禁用开关。

复用已实现的 `layout_model_info`（返回 `{path, exists}`）来判断可用性。

## 6. 模型约定（与主设计一致）

- 输入：`images` `[1,3,1024,1024]` float32，RGB 0–1，letterbox 补边值 114。
- 输出：`output0` `[1,300,6]` = `x1,y1,x2,y2,confidence,class_id`（模型内已 NMS），阈值 0.3。
- 类别：0 title / 1 plain text / 2 abandon / 3 figure / 4 figure_caption / 5 table / 6 table_caption / 7 table_footnote / 8 isolate_formula / 9 formula_caption。

## 7. 前端接入方式

- 新增设置项：`设置 → 阅读 → 启用版面模型（实验性）`，默认 **关闭**。
- 关闭时：Stage 1 的抽取结果原样使用，UI 不出现任何模型相关提示。
- 打开且模型存在时：`readingStructureRef` 走"Stage 1 + Stage 2"混合流程——
  1. Stage 1 产出文本行、段落、参考文献、位图（`layout/pdfStructure.ts` 的纯文本路径）。
  2. 对每页额外渲染 1024 长边的 PNG，调用 `detect_layout`。
  3. 用检测框补齐 `figure`/`table`/`formula` 区域；对矢量图，从该页渲染结果裁剪（此时页面 canvas 已在手，只裁剪需要的区域，比例按显示宽度）。
  4. `abandon` 框内的文本行丢弃（页眉/页脚/页码），并与 Stage 1 的"页边重复行剔除"取并集。
  5. 文本行与检测框的对应：Stage 1 的行矩形中心落在 `plain text`/`title` 框内 → 归为该区域；落在 `abandon` → 丢弃；落在 caption 框 → 作为图注候选。
- 任一页推理失败 → 该页退回 Stage 1 纯文本结果，并在 `DocumentStructure.notice` 记一条。
- 推理进度沿用 `extractProgress`。

## 8. 性能预期

单页：渲染 PNG ~50 ms + IPC ~10 ms + 解码 ~100 ms + 推理 ~150–400 ms ≈ **0.3–0.6 s/页**。
100 页文档约 30–60 s，因此**默认关闭**，且必须显示进度条与取消入口。

## 9. 风险

| 风险 | 对策 |
|------|------|
| `ort` 的 `download-binaries` 需要联网构建 | 提供 `load-dynamic` 备选路径；CI 里预下载 |
| PNG 编解码开销吃掉收益 | 前端按 1024 渲染 + PNG 无损但体积可控；必要时改 JPEG（模型精度不受影响） |
| 模型对中文/特殊版式误判 | 置信度阈值 0.3 + 未覆盖文字全部保留（沿用 Stage 1 的不变量） |
| 矢量图裁剪需要页面 canvas，内存高 | 只保留含图的页渲染结果，裁剪后立即释放 |
| 用户误以为"模型更好"而牺牲速度 | 开关默认关闭，并在设置里写清耗时预期 |

## 10. 验收（Stage 2 实施时）

1. 关闭开关时，Stage 1 行为与 Stage 1 验收完全一致（无回归）。
2. 打开开关并放好模型：矢量图、表格出现在正确位置，与 Stage 1 的文字顺序一致。
3. 缺模型时开关禁用并提示路径。
4. 单页耗时 ≤ 1 s（普通 A4 页面）。
5. 推理失败时该页退回 Stage 1，不整体失败。
