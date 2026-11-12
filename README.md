<p align="center">
  <img src="docs/assets/scholarust-icon.svg" width="104" height="104" alt="ScholaRust 图标">
</p>

<h1 align="center">ScholaRust</h1>

<p align="center">
  用 Rust + Tauri 2 构建的本地学术文献阅读管理器<br>
  多格式阅读 · 阅读模式重排 · 逐段对照翻译 · 本地 OCR · WASM 插件
</p>

---

## 简介

ScholaRust 是一个**离线优先**的学术阅读工具：Zotero 式的三栏文库管理，PDF / EPUB / Word / Markdown / 纯文本（以及插件导入的格式）统一阅读；「阅读」模式把 PDF 重排为连续单栏文章，剔除页眉页脚，按标题 / 摘要 / 正文 / 注释分块并支持逐块翻译；扫描件用右侧「OCR」面板框选识别；翻译与 OCR 都可以走本地模型，不联网也能用。

界面参考 Zotero 的信息组织方式与 ScholarRead 的三栏阅读体验，翻译框架参考 [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate)；扩展统一为沙箱内运行的 WASM 插件。

## 功能

### 阅读

- **多格式**：PDF（pdf.js + TextLayer 文字选取）、EPUB（epub.js）、Word（mammoth）、Markdown / 纯文本；插件可扩展任意格式（例如图片）。
- **原文 / 阅读双模式**：原文保留原始排版；阅读模式把 PDF 按文字坐标重建行与段落，用栏缝覆盖直方图识别双栏并还原阅读顺序，按字号与编号识别标题层级，剔除重复页眉、页脚、页码，参考文献逐条切分；正文图片按原位保留（最长边 1600 px）。
- **阅读设置**：字号 14–24 px 可调、译文一键开关；大纲、搜索复用同一份结构。
- **大纲跳转**：PDF 优先用内嵌书签，EPUB 用导航目录，其余按文档标题；点击一次精确到位（已考虑吸顶工具栏偏移）。

### 翻译

- **服务**：Google、MyMemory、OpenAI 兼容接口、**本地 GGUF 模型**、WASM 插件服务。
- **划词翻译**：PDF / EPUB / HTML 选中文字即翻译。
- **逐段 / 全文对照**：「翻译正文」把逐段译文内联到原文下方，可随时取消；已完成的译文会保留。
- **术语中间层**：中间层插件在任意服务返回译文后自动校正术语（例如材料专业术语表），不占用翻译服务下拉。

### OCR（扫描件）

- 右栏打开「OCR」面板后，在 **PDF 页面或图片**上拖动框选区域，直接裁剪高分辨率画布交给本地视觉模型；结果显示在面板里，可复制或一键翻译。
- 只识别选中的区域，页眉页脚与图表不会混进正文；**截图只在内存中生成，不写入本地文件**。
- 可与翻译模型同时常驻（OCR 使用独立端口 18713）。

### 文库与界面

- **左栏**：全部文档 / 最近打开 / 收藏夹（可嵌套）/ 按格式筛选 / 标签计数；插件解析的格式会自动出现分类（如图片的「图片」）。
- **右栏**：IDE 式活动栏——翻译、大纲、OCR、笔记、搜索、扩展、设置，面板宽度可拖拽。
- **窗口**：启动最大化、WebView 缩放固定 100%，页面级不会出现多余滚动条。

## 快速开始

### 环境要求

- Windows 10/11 x64
- Rust stable（MSVC toolchain）+ Visual Studio Build Tools（C++ 工作负载）
- Node.js 18+

本地模型使用 llama.cpp Vulkan 预编译版，无需 CUDA toolkit；NVIDIA / AMD / Intel 显卡均可 GPU 加速（没有独显也能用 CPU，速度较慢）。

### 启动

```bat
:: 双击 scholarust.bat，或：
scholarust.bat            :: 启动（自动安装依赖，新窗口显示日志）
scholarust.bat stop       :: 停止应用、模型服务与 dev server
scholarust.bat status     :: 查看运行状态
```

等价手动命令：

```bash
npm install
npm --prefix frontend install
npm run dev              # tauri dev
```

打包发布版：`npm run build`（tauri build）。

首次启动后点左栏「打开文件」选择文档（可先试 `examples/sample-paper.md`）；工具栏切换到「阅读」查看重排结果。扫描件在右栏打开「OCR」面板后框选识别。插件在右栏「扩展」→「导入插件包（.zip）」安装。

## 目录结构

```text
scholarust/
├── app/                    Tauri 壳：命令、状态、模型管理器（src/model.rs）
├── crates/
│   ├── core/               文档抽象、Library（收藏夹 / 标签）、Markdown 渲染
│   ├── translate/          翻译框架：任务、服务注册表、Google / MyMemory / OpenAI
│   └── plugin-host/        Extism WASM 插件宿主（服务 / 解析 / 面板 / 中间层）
├── frontend/               Vite + React + TS（三栏布局、panels/ 面板注册表）
├── plugins/
│   ├── example-translate/  示例术语中间层插件（Rust + extism-pdk）
│   ├── image-import/       图片导入解析插件
│   └── *.zip               可直接导入的插件包
├── examples/               示例文档
├── docs/
│   ├── plugin-development.md   插件开发参考（含机器可读契约）
│   └── assets/                 README 图标等资源
├── models/                 模型权重与推理引擎（不入 git，见下文）
└── scholarust.bat          一键启停脚本
```

## 本地模型

`models/` 不入 git，按需下载。翻译与 OCR 各用独立的 llama-server 实例，互不挤占显存；应用退出时自动回收。

```text
models/
├── llama.cpp/                    llama-server 与后端 DLL（Vulkan + CPU）
├── llm/
│   └── Hy-MT2-1.8B/              翻译模型（每个模型一个子文件夹）
│       └── Hy-MT2-1.8B-Q8_0.gguf
├── ocr/
│   └── MiniCPM-OCR-1.0/          OCR 主模型 + mmproj 必须同文件夹
│       ├── MiniCPM-OCR-1.0.Q6_K.gguf
│       └── MiniCPM-OCR-1.0.mmproj-bf16.gguf
└── layout/                       （预留）阅读模式版面模型
```

扫描规则：

- **翻译 `models/llm/`**：递归扫描 `.gguf`，多个模型时取最近修改的一个。
- **OCR `models/ocr/`**：主模型（非 mmproj）与投影（文件名含 `mmproj`）在**同一个模型文件夹**内配对；多个模型时取最近修改的完整文件夹，不会跨模型混配。
- **版面 `models/layout/`**：任意 `.onnx`（阅读模式目前不依赖它，见「已知限制」）。

### 翻译模型

```bash
mkdir -p models/llm/Hy-MT2-1.8B models/llama.cpp
# GGUF 权重（Q8_0，约 1.9 GB；也可换 Q4_K_M / Q6_K 或任意 GGUF）
curl -L -o models/llm/Hy-MT2-1.8B/Hy-MT2-1.8B-Q8_0.gguf \
  https://modelscope.cn/models/Tencent-Hunyuan/Hy-MT2-1.8B-GGUF/resolve/master/Hy-MT2-1.8B-Q8_0.gguf
# llama.cpp Vulkan 预编译（资产名随版本变化，见 releases 页）
curl -L -o /tmp/llama.zip \
  https://github.com/ggml-org/llama.cpp/releases/download/b12211/llama-b12211-bin-win-vulkan-x64.zip
unzip -o /tmp/llama.zip -d models/llama.cpp
```

使用：右栏「设置」→ 本地模型 →「启动」（或翻译时自动启动），翻译服务选「本地模型」。

效率配置（`app/src/model.rs`）：`-ngl 99` 全量 GPU offload、flash attention、16K 上下文、4 路并行、常驻暖服务；段落级并发请求。参考实测（RTX 4070 Laptop）：单段学术文本约 1.9 s（约 116 tok/s），4 段并发合计约 1.9 s。

### OCR 模型

```bash
mkdir -p models/ocr/MiniCPM-OCR-1.0
curl -L -o models/ocr/MiniCPM-OCR-1.0/MiniCPM-OCR-1.0.Q6_K.gguf \
  https://www.modelscope.cn/models/prithivMLmods/MiniCPM-OCR-1.0-GGUF/resolve/master/MiniCPM-OCR-1.0.Q6_K.gguf
curl -L -o models/ocr/MiniCPM-OCR-1.0/MiniCPM-OCR-1.0.mmproj-bf16.gguf \
  https://www.modelscope.cn/models/prithivMLmods/MiniCPM-OCR-1.0-GGUF/resolve/master/MiniCPM-OCR-1.0.mmproj-bf16.gguf
```

扫描结果显示在「设置」→「OCR 模型」。首次识别时自动启动独立服务（端口 18713）；服务日志写入 `models/llama-server-18713.log`。

### 版面模型（预留）

DocLayout-YOLO 版面识别属于后续可选阶段，阅读模式当前是纯前端抽取，**不需要**该模型。预留路径：

```bash
mkdir -p models/layout
curl -L -o models/layout/doclayout_yolo_docstructbench_imgsz1024.onnx \
  https://hf-mirror.com/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx
```

## 插件系统

统一 ZIP 插件包：包根部（或唯一一层根目录内）包含 `plugin.json` 与 `.wasm` 入口，可附 `README.md`。在右栏「扩展」面板导入后即可启用/停用、查看详情、卸载；翻译服务与格式分类实时更新。插件运行在 Extism WASM 沙箱内，只能使用清单声明的能力。

### 插件类型

| `kind` | 作用 | 出现位置 |
| --- | --- | --- |
| `translate` | 翻译服务 | 翻译服务下拉 |
| `middleware` | 译文后处理（如术语校正） | 启用后自动生效，**不进入**服务下拉 |
| `panel` | 声明式右侧面板，可交互 | 右栏活动栏 |
| `parser` | 自定义格式解析 | 打开对话框 + 「按格式」分类（取 `label`） |

### 声明式 UI

面板内容只允许固定元素，插件永远无法注入 HTML / 脚本：

- 文本：`paragraph`、`list`、`keyValue`
- 交互：`actions`（按钮）、`form`（text / textarea / number / select / checkbox）
- 图表：`chart`（`bar` / `line` / `pie`，SVG 渲染）

交互节要求 `apiVersion: 3` 并导出 `action`：按钮点击或表单提交时，宿主调用
`action({ panelId, actionId, values? })`，插件返回 `{ sections?, notice? }`——返回 `sections` 会替换当前面板，只返回 `notice` 时动态面板自动刷新。

### 自带示例

- `plugins/example-translate.zip`：材料专业英文术语**中间层**（650 余条术语，`kind: "middleware"`）。启用后自动校正任意翻译服务译文中的英文术语；不会出现在翻译服务下拉。
- `plugins/image-import.zip`：图片导入解析插件，支持 PNG / JPG / WebP / BMP / GIF / TIFF。安装后「按格式」出现 **图片** 分类，原文视图直接预览，阅读视图按图片块展示；单张约 1.5 MB 以内可直接内嵌，更大的会提示压缩。

最小中间层清单示例：

```json
{
  "name": "材料专业英文术语",
  "version": "0.3.0",
  "entry": "example_translate.wasm",
  "apiVersion": 2,
  "kind": "middleware",
  "permissions": { "docRead": false, "storage": false, "http": [] }
}
```

### 开发与打包

完整字段、导出契约、限额、错误目录与机器可读契约见 **[`docs/plugin-development.md`](docs/plugin-development.md)**。

```bash
rustup target add wasm32-unknown-unknown
cd plugins/example-translate
cargo build --release --target wasm32-unknown-unknown
# 打包：plugin.json、wasm、README.md 位于 zip 根部
powershell -Command "Compress-Archive -Path plugin.json, target/wasm32-unknown-unknown/release/example_translate.wasm, README.md -DestinationPath example-translate.zip -Force"
```

图片插件可用 `plugins/build-image-plugin.sh` 重新构建并打包。

## 数据与备份

- 用户数据：`%APPDATA%/com.scholarust.app/`
  - `library.json`：文库、收藏夹、标签
  - `settings.json`：翻译服务、目标语言、OpenAI 配置
  - `notes/`：按文档存放的笔记
  - `plugins/`：已安装插件
- OCR 截图、翻译缓存不落盘（仅内存）；`models/` 与用户数据目录相互独立，可单独备份。

## 开发与测试

```bash
# 前端
npm --prefix frontend install
npm --prefix frontend run dev      # Vite（端口 5173）
npm --prefix frontend test         # Vitest
npm --prefix frontend run build    # tsc --noEmit + vite build

# Rust
cargo test --workspace
cargo check --manifest-path app/Cargo.toml

# 完整应用
npm run dev                        # tauri dev
npm run build                      # tauri build
```

## 架构要点

- **阅读结构**（`frontend/src/structure.ts`）：PDF 文本按行聚类，跨页重复行 + 页面顶/底区域 + 纯页码模式剔除页眉页脚；以正文主字号为基准，按字号比例、章节编号、关键词识别标题层级；按段间距、首行缩进、跨页续句合并段落；摘要 / 参考文献 / 注释按章节状态机归类；双栏通过栏缝覆盖直方图还原阅读顺序。HTML / EPUB 直接按语义标签分块。
- **翻译框架**：`TranslateTask` → `ServiceRegistry`（语言检测 → 同语种跳过 → 主服务 → 候选回退），`translate_paragraphs` 以 `buffered(3)` 并发保序；结果再依次经过启用的 `middleware`。
- **模型管理**（`app/src/model.rs`）：`ModelManager` 负责 llama-server 生命周期与健康检查；翻译端口 18712、OCR 端口 18713；日志写入 `models/llama-server-<port>.log`。
- **插件宿主**（`crates/plugin-host`）：Extism + fuel / 内存 / 超时限额；安装前校验清单与导出；解析器输出复用阅读视图的块模型。
- **面板注册**（`frontend/src/panels/registry.ts`）：内置面板 `registerPanel()`，插件面板由清单声明，统一进入右栏活动栏。

## 已知限制

- 仅针对 Windows 10/11 构建与验证；macOS / Linux 未测试。
- OCR 是**框选识别**，不做整本扫描件解析；EPUB 的内容位于 iframe 中，暂不支持框选（PDF 页面与图片支持）。
- 图片插件内嵌原图约 1.5 MB 上限（宿主对插件图片有 2 MiB base64 限制），更大的图片需先压缩。
- DocLayout 版面模型尚未启用，复杂版面的阅读顺序仍依赖前端启发式规则。
- 本地模型的推理速度取决于显卡与显存；OCR 首次请求包含模型加载时间。

## 许可

[AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.html)