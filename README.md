# ScholaRust

用 Rust 重写的类 Zotero 文献阅读管理器：Tauri 2 + React 前端，ScholarRead 式三栏布局与逐段对照翻译，借鉴 [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate) 的翻译服务框架，支持 WASM 插件扩展。

## 功能

- **多格式阅读**：PDF（pdf.js，含 TextLayer 文字选取）、EPUB（epub.js）、Word（mammoth）、Markdown / 纯文本
- **阅读模式**：一键把文章重排为干净的阅读视图——按重复行/位置剔除页眉、页脚、页码，按字号与编号识别标题、章节、摘要、正文、注释、参考文献并分块；每块独立「翻译此块」按钮，「翻译正文」只批量翻译标题/章节/摘要/正文/注释（不含参考文献与图表说明），译文逐块即时回填
- **划词翻译**：PDF/EPUB/HTML 中选中文字即自动翻译（PDF 通过 pdf.js TextLayer 支持选取）
- **翻译服务**：Google、MyMemory、OpenAI 兼容接口、**Hy-MT2 本地模型**、WASM 插件服务；自动语言检测、同语种跳过、候选服务回退、并发批量翻译；仅 OpenAI 兼容服务需要填写 Endpoint/Model/API Key
- **左栏分类管理**（Zotero 式）：全部文档 / 最近打开 / 收藏夹（可嵌套、新建/重命名/删除）/ 按格式下拉筛选 / 标签（带计数），文档列表支持标签与 ⋯ 菜单
- **右栏 IDE 式面板**（VS Code 式 activity bar）：翻译（含本地模型状态卡）、大纲（PDF 按识别出的真实标题跳转页码）、笔记、搜索、扩展（插件导入/启停/卸载）、设置；通过 `frontend/src/panels/registry.ts` 的 `registerPanel()` 注册新面板
- **本地模型翻译**：Hy-MT2-1.8B（GGUF Q8_0）+ llama.cpp Vulkan 后端，GPU 全量 offload，常驻服务免重载
- **插件管理**：统一 ZIP 插件包格式，扩展面板内导入、启用/停用、卸载，翻译服务注册表实时更新

## 目录结构

```
scholarust/
├── app/                  Tauri 壳：命令、状态、本地模型管理器（src/model.rs）
├── crates/
│   ├── core/             文档抽象、Library（收藏夹/标签）、Markdown 渲染
│   ├── translate/        翻译框架：任务、服务注册表、Google/MyMemory/OpenAI 服务
│   └── plugin-host/      Extism WASM 插件宿主
├── frontend/             Vite + React + TS 前端（三栏布局、panels/ 面板注册表）
├── plugins/example-translate/   示例 WASM 翻译插件（Extism PDK，术语表替换）
├── examples/             示例文档（sample-paper.md）
├── models/               模型权重与推理引擎（不入 git，见下文下载）
└── scholarust.bat        一键启停脚本
```

## 环境要求

- Windows 10/11 x64（本地模型使用 llama.cpp Vulkan 预编译版，无需 CUDA toolkit；有 NVIDIA/AMD/Intel 显卡即可 GPU 加速）
- Rust stable（MSVC toolchain）+ Visual Studio Build Tools（C++ 工作负载）
- Node.js 18+

## 快速开始

```bat
:: 双击 scholarust.bat 或：
scholarust.bat            :: 启动（自动安装依赖，新窗口显示日志）
scholarust.bat stop       :: 停止应用、模型服务与 dev server
scholarust.bat status     :: 查看运行状态
```

等价手动命令：`npm install && npm --prefix frontend install && npm run dev`。
打包发布版：`npm run build`（tauri build）。

首次启动后点左栏「打开文件」选择文档（可先试 `examples/sample-paper.md`），工具栏点「阅读模式」即可看到重排后的分块阅读视图，逐块点击「翻译此块」或一键「翻译正文」。

## 本地模型（Hy-MT2）

`models/` 目录不入 git，按需下载（国内推荐 ModelScope，约 12MB/s）：

```bash
mkdir -p models/hy-mt2-1.8b-gguf models/llama.cpp
# GGUF 权重（Q8_0，1.9GB；也可换 Q4_K_M/Q6_K，代码自动择优）
curl -L -o models/hy-mt2-1.8b-gguf/Hy-MT2-1.8B-Q8_0.gguf \
  https://modelscope.cn/models/Tencent-Hunyuan/Hy-MT2-1.8B-GGUF/resolve/master/Hy-MT2-1.8B-Q8_0.gguf
# llama.cpp Vulkan 预编译（资产名随版本变化，见 releases 页）
curl -L -o /tmp/llama.zip \
  https://github.com/ggml-org/llama.cpp/releases/download/b12211/llama-b12211-bin-win-vulkan-x64.zip
unzip -o /tmp/llama.zip -d models/llama.cpp
```

FP8 原始权重（可选，研究用）：`https://hf-mirror.com/tencent/Hy-MT2-1.8B-FP8/resolve/main/model.safetensors` → `models/hy-mt2-1.8b-fp8/`。

使用：右栏「设置」→ 本地模型 →「启动」（或翻译时自动惰性启动），翻译服务选「Hy-MT2 本地模型」。

**效率优化**（`app/src/model.rs`）：`-ngl 99` 全量 GPU offload、`--flash-attn on`、16K 上下文、`--parallel 4` 连续批处理、常驻暖服务（启动一次反复使用）、段落级并发请求。实测 RTX 4070 Laptop：单段学术文本 1.9s（约 116 tok/s），4 段并发合计 1.9s。

## 版面模型（Stage 2，尚未启用）

当前的阅读模式是纯前端抽取（pdf.js 文字层坐标 + 分栏重排），**不需要**模型，也不会调用下面的文件。

DocLayout-YOLO 版面识别属于后续可选阶段（设计见 `docs/superpowers/specs/2026-11-11-layout-model-stage-design.md`），届时放好模型并在设置里开启即可；现在下载它不会有任何效果。预留路径：

```bash
mkdir -p models/layout
curl -L -o models/layout/doclayout_yolo_docstructbench_imgsz1024.onnx \
  https://hf-mirror.com/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx
```

## 插件（统一 ZIP 包格式）

**导入格式固定为 ZIP 插件包**：压缩包根部（或单层根目录内）包含 `plugin.json` 与 `.wasm` 入口。在右栏「扩展」面板点「导入插件包（.zip）」选择文件即可，无需重启；同一面板可启用/停用、卸载，翻译服务下拉实时更新。仓库自带示例包 `plugins/example-translate.zip` 可直接导入体验。

`plugin.json` 字段：

```json
{
  "name": "术语词条例句",
  "version": "0.1.0",
  "description": "示例插件：用内置术语表把英文学术词汇替换为中文",
  "entry": "example_translate.wasm",
  "enabled": true
}
```

`enabled` 可省略（默认 true）；停用状态持久化在插件目录的 plugin.json 中。插件为 Extism WASM 模块（沙箱运行），须导出 `translate` 函数：输入 JSON `{raw, targetLang}`，输出 `{result}`。导入时会先实例化校验 wasm 与导出函数，再写入 `%APPDATA%/com.scholarust.app/plugins/<name>/`；同名插件再次导入即覆盖升级。停用/卸载时若当前翻译服务正指向该插件，自动回退到 Google。

开发参考 `plugins/example-translate`（Rust + extism-pdk）：

```bash
rustup target add wasm32-unknown-unknown
cd plugins/example-translate
cargo build --release --target wasm32-unknown-unknown
# 打包：把 plugin.json 与 target/wasm32-unknown-unknown/release/example_translate.wasm 压缩为 zip（两者位于包根部）
powershell -Command "Compress-Archive -Path plugin.json, target/wasm32-unknown-unknown/release/example_translate.wasm -DestinationPath example-translate.zip -Force"
```

## 数据与测试

- 用户数据：`%APPDATA%/com.scholarust.app/`（library.json、settings.json、notes/、plugins/）
- 测试：`cargo test --workspace`；前端类型检查+构建：`npm --prefix frontend run build`

## 架构要点

- 翻译框架与 Translate for Zotero 同构：`TranslateTask` → `ServiceRegistry`（语言检测 → 同语种跳过 → 主服务 → 候选回退），`translate_paragraphs` 以 buffered(3) 并发保序
- 阅读模式结构解析（`frontend/src/structure.ts`）：PDF 文本按行聚类后，用跨页重复行 + 页面顶/底区域 + 纯页码模式剔除页眉页脚；以正文主字号为基准，按字号比例、章节编号（1 / 2.1）、关键词（Abstract/References/摘要…）识别标题层级；按段间距、首行缩进、跨页续句（含断词去连字符）合并段落；摘要/参考文献/注释按章节状态机归类。HTML/EPUB 直接按语义标签分块。双栏 PDF 暂按单栏阅读顺序处理
- 本地模型走 OpenAI 兼容 HTTP（127.0.0.1:18712），Rust 侧 `ModelManager` 负责进程生命周期与健康检查，应用退出自动回收
- 前端面板全部经 `panels/registry.ts` 注册，新增面板只需实现组件并 `registerPanel()`