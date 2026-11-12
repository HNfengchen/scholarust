# ScholaRust 插件开发参考

本文件同时面向**人类开发者**与**AI 代码生成器**。所有接口均使用固定 ID、统一类型系统和可机器解析的元数据；
机器契约位于 [§14](#14-机器可读契约json)，与各接口章节一一对应。

## 0. 文档元数据

| 键 | 值 |
| --- | --- |
| `docVersion` | `3.0.0` |
| `contractVersion` | `2` |
| `hostApiVersion` | `2`（`plugin.json.apiVersion` 允许 `1..=2`） |
| `runtime` | Extism 1.41 / Wasmtime 49 / Tauri 2 |
| `updatedAt` | `2026-11-12` |
| `machineContract` | [§14](#14-机器可读契约json) |
| `referenceImplementation` | `plugins/example-translate/` |

### 0.1 怎么读

| 读者 | 建议路径 |
| --- | --- |
| 人类开发者（首次开发） | §1 快速开始 → §3 插件包 → §4 清单 → §5 接口 → §10 最佳实践 |
| 人类开发者（查询字段） | §7 数据模型 → §8 错误目录 → §9 运行上限 |
| AI / 代码生成器 | 先读 §14，再按 `interfaceId` 跳转对应章节；未在 §14 声明的字段一律视为不存在 |

### 0.2 AI 生成硬性规则

1. 只使用本文档声明的字段名；JSON 一律 **camelCase**，Rust 侧标识符一律 **snake_case**。
2. `EXPORT` 接口是 WASM 函数调用，**不是 HTTP**：不要生成 URL、`Content-Type`、状态码或 HTTP 动词。
3. `extract` 的输入**没有** `data` 字段；文件内容只能通过 `sr_file_read` 分块读取。
4. `translate` 的输入只有 `raw` 与 `targetLang`；输出必须是 `{"result": string}`。
5. `panel` 只对 `dynamic: true` 的面板调用；返回值必须是 `{"sections": PanelSection[]}`。
6. 任何未在 §14 声明的字段、枚举值或接口都属于非法调用，应返回错误而不是猜测。
7. 错误不是结构化对象：`EXPORT`/`HOST_FN` 抛出 Extism 错误，`IPC` 返回 rejected promise（`string`）。
   生成代码时只透传错误消息，不要假设存在 `code` 字段。

---

## 1. 快速开始（5 分钟）

### 1.1 目录

```text
my-plugin/
├── Cargo.toml
├── plugin.json
├── README.md
└── src/
    └── lib.rs
```

### 1.2 `Cargo.toml`

```toml
[package]
name = "my-plugin"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
extism-pdk = "1"
serde_json = "1"

[profile.release]
lto = true
opt-level = "s"
```

### 1.3 `src/lib.rs`：最小翻译插件

```rust
use extism_pdk::*;
use serde_json::Value;

#[plugin_fn]
pub fn translate(input: String) -> FnResult<String> {
    let value: Value = serde_json::from_str(&input)?;
    let raw = value.get("raw").and_then(Value::as_str).unwrap_or("");
    let _target_lang = value
        .get("targetLang")
        .and_then(Value::as_str)
        .unwrap_or("");

    let translated = raw.replace("annealing", "退火");
    Ok(serde_json::json!({ "result": translated }).to_string())
}
```

### 1.4 `plugin.json`

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "示例翻译插件",
  "entry": "my_plugin.wasm",
  "enabled": true,
  "apiVersion": 2,
  "kind": "translate",
  "permissions": { "docRead": false, "storage": false, "http": [] }
}
```

### 1.5 构建与打包

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
# crate 名中的 '-' 会变成 '_'：my-plugin → my_plugin.wasm
zip -j my-plugin.zip plugin.json target/wasm32-unknown-unknown/release/my_plugin.wasm README.md
```

在应用「扩展」面板导入 ZIP。宿主先展示权限、版本与摘要预览，确认后才安装。

---

## 2. 统一约定

### 2.1 接口方向与调用方式

| `method` | 含义 | `path` 格式 | 调用方 |
| --- | --- | --- | --- |
| `EXPORT` | 宿主调用插件导出的 WASM 函数 | `wasm://plugin/<export>` | 宿主 → 插件 |
| `HOST_FN` | 插件调用宿主注册的函数 | `extism:host/user/<name>` | 插件 → 宿主 |
| `HTTP` | 插件调用 Extism 内置 HTTP | `extism:host/env/http_request` | 插件 → 网络 |
| `IPC` | 前端通过 Tauri `invoke` 调用宿主命令 | `tauri://invoke/<command>` | 前端 → 宿主 |
| `MANIFEST` | 读取插件包内的 `plugin.json` | `zip://plugin.json` | 宿主 |

### 2.2 数据类型

| 文档类型 | JSON 表示 | 约束 |
| --- | --- | --- |
| `string` | string | UTF-8；长度单位默认是**字节** |
| `integer` | number | 32/64 位整数，不接受小数 |
| `boolean` | boolean | `true` / `false` |
| `array<T>` | array | 元素类型一致 |
| `object` | object | 字段名 camelCase |
| `null` | null | 仅显式标注 `T \| null` 的字段可空 |
| `T?` | 省略或 `null` | 可选字段；除特别说明外，`null` 与省略等价 |

- Base64 使用 RFC 4648 标准字母表并带 `=` 填充。
- 图片只接受 Data URL：`data:image/<subtype>;base64,<payload>`。
- 所有 JSON 输入都是单个对象，UTF-8 编码，不允许尾随额外字节。
- 枚举值大小写敏感。

### 2.3 错误约定

- `EXPORT` / `HOST_FN`：失败即抛出 Extism 错误，调用方看到一条 `string` 消息；插件实例可能因此不可继续使用。
- `IPC`：Promise reject，类型为 `string`。
- 本文档用 **Error ID** 对错误分类（见 §8）。Error ID 是文档层标识，**不会**出现在消息或响应字段中。
- 插件应把宿主错误视为不可重试的失败，除非 §8 明确标注“可重试”。

### 2.4 权限与能力

| 能力 | 清单字段 | 默认 | 作用域 |
| --- | --- | --- | --- |
| 只读文档 | `permissions.docRead` | `false` | 当前打开文档的文本块 |
| 私有存储 | `permissions.storage` | `false` | `<插件目录>/storage.json` |
| 网络 | `permissions.http` | `[]` | Extism `http_request` 主机白名单 |
| 解析文件 | 无清单字段 | 仅 `kind:"parser"` | 当前 `extract` 调用的那一个文件 |

`sr_file_read` 不需要（也不接受）清单权限声明；它只在 `extract` 执行期间存在。

---

## 3. 插件包规范

### 3.1 ZIP 布局

```text
my-plugin.zip
├── plugin.json            # 必需，位于根部或唯一一层根目录内
├── <entry>.wasm           # 必需，文件名与 plugin.json.entry 完全一致
└── README.md              # 可选
```

| 约束 | 值 |
| --- | --- |
| `plugin.json` 位置 | ZIP 根部，或唯一一层文件夹内 |
| `plugin.json` 数量 | 必须恰好 1 个 |
| WASM 大小 | ≤ 16 MiB |
| 其他文件 | 安装时忽略；只有清单、entry 与 README 会写入插件目录 |
| 安装目录 | `<应用数据目录>/plugins/<name>/` |

### 3.2 安装流程（宿主行为）

1. **预览**（`inspect_plugin`）：读取并校验 ZIP 与清单，计算 WASM 的 SHA-256 摘要，检测扩展名冲突；**此步不实例化 WASM**。
2. 返回安装预览：`info`、`digest`、`installed`、`versionChange`、`conflicts`。
3. **安装**（`import_plugin`，用户确认后）：先拒绝扩展名冲突；再以正式运行限额实例化 WASM 探针并检查导出；通过后才写入磁盘。无效包不会污染已安装插件。
4. 与同一 `name` 的旧版本原地替换（整目录删除后重写）。
5. 若清单 `enabled: true`，立即注册服务 / 解析器 / 动态面板。
6. 启用（`set_plugin_enabled`）时同样先实例化并检查扩展名冲突，失败不写入 `enabled`。

### 3.3 README

- 仅支持受限 Markdown：原始 HTML 被丢弃，链接仅允许 `http`/`https`/`mailto`。
- 未附带 README 时，详情页显示“该插件未附带 README.md 说明”。
- 不要把安全说明、许可或使用步骤放在 README 的 HTML 片段中。

## 4. 清单 `plugin.json`（MANIFEST）

### 4.1 顶层字段

| 字段 | 类型 | 必填 | 默认 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- | --- |
| `name` | string | 是 | — | 非空；不含 `/`、`\`、`..`、控制字符；不以 `.` 开头；同时作为目录名与服务 ID 后缀 | `"materials-terms"` |
| `version` | string | 是 | — | 非空；建议 semver，用于预览中的升级/降级判断 | `"0.2.0"` |
| `description` | string | 否 | `""` | 自由文本，显示在插件卡片 | `"材料术语替换"` |
| `entry` | string | 是 | — | 纯文件名；非空；不含 `/`、`\`、`..`、`:` | `"materials_terms.wasm"` |
| `enabled` | boolean | 否 | `true` | 导入后是否立即启用 | `true` |
| `apiVersion` | integer | 否 | `1` | 仅允许 `1..=2` | `2` |
| `kind` | string | 否 | `"translate"` | 枚举：`translate` / `panel` / `parser` | `"translate"` |
| `permissions` | object | 否 | 见 §4.2 | 见 §4.2 | 见示例 |
| `contributes` | object | 否 | `{}` | 见 §4.3、§4.4 | 见示例 |

```json
{
  "name": "paper-parser",
  "version": "1.0.0",
  "description": "解析 .foo 文献格式",
  "entry": "paper_parser.wasm",
  "enabled": true,
  "apiVersion": 2,
  "kind": "parser",
  "permissions": { "docRead": false, "storage": true, "http": [] },
  "contributes": {
    "panels": [],
    "parsers": [{ "id": "foo", "label": "Foo 文献", "extensions": ["foo"], "magic": ["464f4f31"] }]
  }
}
```

### 4.2 `permissions`

| 字段 | 类型 | 必填 | 默认 | 校验规则 | 对应能力 |
| --- | --- | --- | --- | --- | --- |
| `docRead` | boolean | 否 | `false` | — | `sr_doc_read` |
| `storage` | boolean | 否 | `false` | — | `sr_storage_get/set/delete` |
| `http` | string[] | 否 | `[]` | 最多 32 项；每项 ≤253 字节；不含空白/控制字符；不能是纯通配；禁止本机与私网 | Extism `http_request` |

`http` 明确拒绝：`localhost`、`*.localhost`、`*.local`、`127.*`、`0.0.0.0`、`::1`、
`10.*`、`192.168.*`、`172.16.*`–`172.31.*`。空数组表示完全禁网。

### 4.3 `contributes.panels[]`

| 字段 | 类型 | 必填 | 默认 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- | --- |
| `id` | string | 是 | — | 1–64 字节；仅 `[A-Za-z0-9_-]`；同一插件内唯一 | `"stats"` |
| `title` | string | 是 | — | 去空白后非空；≤120 字节 | `"统计"` |
| `description` | string | 否 | `""` | ≤500 字节 | `"只读统计"` |
| `icon` | string | 否 | `"info"` | 枚举：`info`/`list`/`table`/`book`/`notes`/`sparkle` | `"book"` |
| `dynamic` | boolean | 否 | `false` | `true` 时插件必须导出 `panel` | `false` |
| `sections` | array | 否 | `[]` | ≤32 项；类型见 §7.4 | 见示例 |

Section 约束：

| 类型 | 字段 | 约束 |
| --- | --- | --- |
| `paragraph` | `text` | ≤16 KiB |
| `list` | `items` | ≤200 项，每项 ≤4 KiB |
| `keyValue` | `items` | ≤200 项，`key`/`value` 各 ≤4 KiB |

- 整个 `contributes` 的文本总量（描述、section 文本、parser label/extensions）≤64 KiB。
- 一个面板最多 8 个；`kind: "panel"` 至少贡献 1 个面板。
- 静态内容只以文本节点渲染，不执行 HTML/脚本。
- `dynamic: true` 的 `sections` 作为初始占位或回退内容；实际内容由 `PLUGIN.PANEL` 返回。

### 4.4 `contributes.parsers[]`

| 字段 | 类型 | 必填 | 默认 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- | --- |
| `id` | string | 是 | — | 1–64 字节；仅 `[A-Za-z0-9_-]` | `"foo"` |
| `label` | string | 否 | `""` | ≤80 字节 | `"Foo 文献"` |
| `extensions` | string[] | 是 | — | 1–16 项；每项 1–16 字节；仅 `[A-Za-z0-9_-]`；不得覆盖内置格式 | `["foo","bar"]` |
| `magic` | string[] | 否 | `[]` | ≤8 项；每项 1–32 字节的偶数长度十六进制串；在偏移 0 匹配 | `["464f4f31"]` |

- 内置扩展名：`pdf`、`epub`、`docx`、`md`、`markdown`、`txt`、`text`，解析插件不能声明。
- 同一扩展名在**所有启用插件**中必须唯一；安装/启用冲突会被拒绝，启动时冲突插件被跳过并标记 `conflict`。
- 扩展名未知时，宿主读取文件前 64 字节做 `magic` 匹配；匹配后使用该 parser 的首个扩展名。
- 只要任一启用 parser 声明了 `magic`，打开对话框就会出现“所有文件”过滤项。

### 4.5 清单校验汇总

| 规则 | 结果 |
| --- | --- |
| `kind` 非 `translate`/`panel`/`parser` | 拒绝 |
| `apiVersion` 为 0 或 >2 | 拒绝 |
| 动态面板但无 `panel` 导出 | 拒绝 |
| `panel` 类型但无面板 | 拒绝 |
| `parser` 类型但无 parsers，或非 parser 声明 parsers | 拒绝 |
| 扩展名重复（插件内或与其他启用插件） | 拒绝 |
| 扩展名覆盖内置格式 | 拒绝 |
| 面板/解析器字段越界 | 拒绝 |
| HTTP 主机非法或指向本机/私网 | 拒绝 |

### 4.6 运行期只读字段 `conflict`

`PluginInfo.conflict` 由宿主设置，仅出现在 `IPC.LIST_PLUGINS` 等返回值中：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `conflict` | string? | 启动加载时因扩展名冲突被跳过的人类可读原因；无冲突时省略 |

---

## 5. 插件导出接口（EXPORT）

### 5.1 `PLUGIN.TRANSLATE`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `PLUGIN.TRANSLATE` |
| `method` | `EXPORT` |
| `path` | `wasm://plugin/translate` |
| 方向 | 宿主 → 插件 |
| 适用 `kind` | `translate` |
| 必需导出 | `translate` |
| 权限 | 无 |
| 请求 Schema | `TranslateRequest`（§7.1） |
| 响应 Schema | `TranslateResponse`（§7.1） |
| 限制 | 输入 ≤1 MiB；输出 ≤4 MiB；单次调用 10 秒 / fuel 2e9 |
| 错误 | `E_EXPORT_TRANSLATE_MISSING`、`E_PLUGIN_CALL`、`E_PLUGIN_OUTPUT`、`E_PLUGIN_JSON`、`E_PLUGIN_RESULT_MISSING` |

请求字段：

| 字段 | 类型 | 必填 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- |
| `raw` | string | 是 | 非空原文；UTF-8；≤1 MiB | `"The annealing process refines grains."` |
| `targetLang` | string | 是 | 目标语言代码；宿主不校验格式 | `"zh-CN"` |

- 宿主**不传**源语言；插件需要时自行检测。
- 响应必须是单个 JSON 对象，`result` 为字符串；额外字段忽略。
- 返回非 JSON、缺少 `result` 或类型错误都会使本次翻译失败。

完整示例：

```rust
use extism_pdk::*;
use serde_json::{json, Value};

#[plugin_fn]
pub fn translate(input: String) -> FnResult<String> {
    let request: Value = serde_json::from_str(&input)?;
    let raw = request.get("raw").and_then(Value::as_str).unwrap_or("");
    let target = request
        .get("targetLang")
        .and_then(Value::as_str)
        .unwrap_or("zh-CN");

    let result = match target {
        "zh-CN" => raw.replace("annealing", "退火"),
        _ => raw.to_string(),
    };
    Ok(json!({ "result": result }).to_string())
}
```

### 5.2 `PLUGIN.EXTRACT`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `PLUGIN.EXTRACT` |
| `method` | `EXPORT` |
| `path` | `wasm://plugin/extract` |
| 方向 | 宿主 → 插件 |
| 适用 `kind` | `parser` |
| 必需导出 | `extract` |
| 权限 | 隐式：仅可读取当前解析文件（`sr_file_read`） |
| 请求 Schema | `ExtractRequest`（§7.2） |
| 响应 Schema | `ParsedDocument`（§7.2） |
| 限制 | 文件 ≤64 MiB；单次读取 ≤1 MiB；输出 ≤4 MiB；10 秒 / fuel 2e9 |
| 错误 | `E_EXPORT_EXTRACT_MISSING`、`E_FILE_*`、`E_PLUGIN_CALL`、`E_PLUGIN_OUTPUT`、`E_PLUGIN_JSON`、`E_PARSER_CONTRACT` |

请求字段：

| 字段 | 类型 | 必填 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 文件名，不含目录 | `"paper.foo"` |
| `extension` | string | 是 | 命中的 parser 扩展名（小写） | `"foo"` |
| `size` | integer | 是 | 文件字节数；`0..=67108864` | `1048576` |

响应字段：

| 字段 | 类型 | 必填 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- |
| `title` | string? | 否 | ≤500 字节 | `"A Paper"` |
| `notice` | string? | 否 | ≤4096 字节 | `"由 Foo 解析器提取"` |
| `blocks` | array<ParsedBlock> | 是 | ≤20,000 项；总文本 ≤8 MiB | 见下 |
| `blocks[].kind` | string | 否 | 枚举见 §7.2；空字符串按 `paragraph` | `"heading"` |
| `blocks[].text` | string | 是 | 文本；`figure` 时为图注 | `"1 Introduction"` |
| `blocks[].level` | integer | 否 | 默认 `0`；越界钳制到 `0..=6` | `1` |
| `blocks[].image` | string? | 否 | 仅 `figure`；`data:image/...;base64,...`；单张 ≤2 MiB | `"data:image/png;base64,..."` |
| `blocks[].id` | integer | 否 | 由宿主生成，插件提供会被忽略 | — |

- 图片总量 ≤16 MiB；非 `figure` 块携带 `image` 会被拒绝；`figure` 无 `image` 也会被拒绝。
- 宿主按数组顺序生成连续 `id`；阅读视图、大纲、逐段翻译直接复用这些块。
- 原文视图显示提取后的纯文本；`figure` 的图片只在阅读模式渲染。

完整示例（按行读取 JSON Lines 文件）：

```rust
use base64::Engine as _;
use extism_pdk::*;
use serde_json::{json, Value};

#[host_fn]
extern "ExtismHost" {
    fn sr_file_read(request: String) -> String;
}

fn read_chunk(offset: u64) -> FnResult<(Vec<u8>, bool)> {
    let raw = sr_file_read(
        json!({ "offset": offset, "limit": 65536 }).to_string(),
    )?;
    let page: Value = serde_json::from_str(&raw)?;
    let data = base64::engine::general_purpose::STANDARD
        .decode(page["data"].as_str().unwrap_or(""))
        .map_err(|e| Error::msg(e.to_string()))?;
    Ok((data, page["eof"].as_bool().unwrap_or(true)))
}

#[plugin_fn]
pub fn extract(input: String) -> FnResult<String> {
    let request: Value = serde_json::from_str(&input)?;
    let size = request["size"].as_u64().unwrap_or(0);

    let mut bytes = Vec::with_capacity(size as usize);
    let mut offset = 0u64;
    loop {
        let (chunk, eof) = read_chunk(offset)?;
        offset += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        if eof {
            break;
        }
    }

    let text = String::from_utf8_lossy(&bytes);
    let mut blocks = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(title) = line.strip_prefix("# ") {
            blocks.push(json!({ "kind": "heading", "text": title, "level": 1 }));
        } else {
            blocks.push(json!({ "kind": "paragraph", "text": line, "level": 0 }));
        }
    }
    Ok(json!({
        "title": request["name"].as_str().unwrap_or("Document"),
        "blocks": blocks
    })
    .to_string())
}
```

Cargo 依赖：

```toml
[dependencies]
extism-pdk = "1"
serde_json = "1"
base64 = "0.22"
```

### 5.3 `PLUGIN.PANEL`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `PLUGIN.PANEL` |
| `method` | `EXPORT` |
| `path` | `wasm://plugin/panel` |
| 方向 | 宿主 → 插件 |
| 适用 `kind` | 任意 `kind`，但必须至少有一个 `dynamic: true` 的面板 |
| 必需导出 | `panel` |
| 权限 | 无（插件内部调用其他能力时按各自权限校验） |
| 请求 Schema | `PanelRequest`（§7.3） |
| 响应 Schema | `PanelResponse`（§7.3） |
| 限制 | 输出 ≤64 KiB；section 数量与文本上限同 §4.3 |
| 错误 | `E_EXPORT_PANEL_MISSING`、`E_PANEL_UNKNOWN`、`E_PANEL_OUTPUT`、`E_PANEL_JSON`、`E_PERMISSION_DENIED` |

请求字段：

| 字段 | 类型 | 必填 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- |
| `panelId` | string | 是 | 必须匹配清单中的 `dynamic: true` 面板 `id` | `"stats"` |

响应字段：

| 字段 | 类型 | 必填 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- |
| `sections` | array<PanelSection> | 是 | ≤32 项；类型与文本限制见 §4.3 | 见示例 |

完整示例：

```rust
use extism_pdk::*;
use serde_json::{json, Value};

#[host_fn]
extern "ExtismHost" {
    fn sr_storage_get(key: String) -> String;
}

#[plugin_fn]
pub fn panel(input: String) -> FnResult<String> {
    let request: Value = serde_json::from_str(&input)?;
    let panel_id = request["panelId"].as_str().unwrap_or("");
    if panel_id != "stats" {
        return Err(Error::msg("unknown panel"));
    }
    let count = sr_storage_get("parsed".into()).unwrap_or_default();
    Ok(json!({
        "sections": [
            { "type": "paragraph", "text": "插件私有统计" },
            { "type": "keyValue", "items": [
                { "key": "已解析", "value": count }
            ]}
        ]
    })
    .to_string())
}
```

清单中的对应声明：

```json
{
  "kind": "panel",
  "permissions": { "storage": true },
  "contributes": {
    "panels": [{ "id": "stats", "title": "统计", "dynamic": true }]
  }
}
```

## 6. 宿主接口

### 6.1 `HOST.SR_DOC_READ`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `HOST.SR_DOC_READ` |
| `method` | `HOST_FN` |
| `path` | `extism:host/user/sr_doc_read` |
| 方向 | 插件 → 宿主 |
| 权限 | `permissions.docRead` |
| 请求 Schema | `DocReadRequest`（§7.8） |
| 响应 Schema | `DocReadResponse`（§7.8） |
| 限制 | 每页 ≤200 块且 ≤512 KiB；快照 ≤20,000 块 / 8 MiB |
| 错误 | `E_PERMISSION_DENIED`、`E_DOC_REQUEST`、`E_DOC_CONTEXT` |

请求字段：

| 字段 | 类型 | 必填 | 默认 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- | --- |
| `offset` | integer | 否 | `0` | 超过总数时按末尾处理 | `0` |
| `limit` | integer | 否 | `1` | 缺省/`0` 按 `1` 处理；钳制到 `1..=200` | `100` |

响应字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 当前文档标题；无文档时 `""` |
| `total` | integer | 块总数 |
| `blocks` | array<DocBlock> | `{id, kind, text}` |
| `truncated` | boolean | 是否还有后续块 |

示例：

```rust
#[host_fn]
extern "ExtismHost" {
    fn sr_doc_read(request: String) -> String;
}

let page = sr_doc_read(
    serde_json::json!({ "offset": 0, "limit": 50 }).to_string(),
)?;
let value: serde_json::Value = serde_json::from_str(&page)?;
```

### 6.2 `HOST.SR_STORAGE_GET`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `HOST.SR_STORAGE_GET` |
| `method` | `HOST_FN` |
| `path` | `extism:host/user/sr_storage_get` |
| 权限 | `permissions.storage` |
| 请求 | `key: string` |
| 响应 | `string`（不存在时为空串） |
| 错误 | `E_PERMISSION_DENIED`、`E_STORAGE_KEY` |

### 6.3 `HOST.SR_STORAGE_SET`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `HOST.SR_STORAGE_SET` |
| `method` | `HOST_FN` |
| `path` | `extism:host/user/sr_storage_set` |
| 权限 | `permissions.storage` |
| 请求 | `key: string, value: string` |
| 响应 | `""` |
| 错误 | `E_PERMISSION_DENIED`、`E_STORAGE_KEY`、`E_STORAGE_VALUE`、`E_STORAGE_QUOTA` |

字段约束：

| 字段 | 类型 | 必填 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- |
| `key` | string | 是 | 非空；≤128 字节；不含控制字符 | `"parsed"` |
| `value` | string | 是 | ≤64 KiB；UTF-8 | `"12"` |

### 6.4 `HOST.SR_STORAGE_DELETE`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `HOST.SR_STORAGE_DELETE` |
| `method` | `HOST_FN` |
| `path` | `extism:host/user/sr_storage_delete` |
| 权限 | `permissions.storage` |
| 请求 | `key: string` |
| 响应 | `""` |
| 错误 | `E_PERMISSION_DENIED`、`E_STORAGE_KEY`、`E_STORAGE_QUOTA` |

```rust
#[host_fn]
extern "ExtismHost" {
    fn sr_storage_get(key: String) -> String;
    fn sr_storage_set(key: String, value: String) -> String;
    fn sr_storage_delete(key: String) -> String;
}

let count = sr_storage_get("parsed".into()).unwrap_or_default();
sr_storage_set("parsed".into(), "13".into())?;
sr_storage_delete("parsed".into())?;
```

### 6.5 `HOST.SR_FILE_READ`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `HOST.SR_FILE_READ` |
| `method` | `HOST_FN` |
| `path` | `extism:host/user/sr_file_read` |
| 方向 | 插件 → 宿主 |
| 权限 | 隐式：仅 `PLUGIN.EXTRACT` 执行期间可用 |
| 请求 Schema | `FileReadRequest`（§7.5） |
| 响应 Schema | `FileReadResponse`（§7.5） |
| 限制 | 单次 ≤1 MiB；只能读取当前被解析文件 |
| 错误 | `E_FILE_SCOPE`、`E_FILE_REQUEST`、`E_FILE_IO` |

请求字段：

| 字段 | 类型 | 必填 | 默认 | 校验规则 | 示例 |
| --- | --- | --- | --- | --- | --- |
| `offset` | integer | 否 | `0` | 超过文件大小时按末尾处理 | `0` |
| `limit` | integer | 否 | `1048576` | 钳制到 `1..=1048576` | `65536` |

响应字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `offset` | integer | 本次实际起始偏移 |
| `data` | string | 本块内容的 Base64 |
| `eof` | boolean | 是否已到文件末尾 |

完整循环示例见 §5.2。

### 6.6 `HOST.SR_LOG`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `HOST.SR_LOG` |
| `method` | `HOST_FN` |
| `path` | `extism:host/user/sr_log` |
| 权限 | 无 |
| 请求 | `message: string` |
| 响应 | `""` |
| 说明 | 写入宿主 stderr，前缀 `[plugin:<name>]`；最多保留 4096 字符 |

```rust
#[host_fn]
extern "ExtismHost" {
    fn sr_log(message: String) -> String;
}

let _ = sr_log("parser: 12 blocks".into());
```

### 6.7 `HOST.HTTP_REQUEST`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `HOST.HTTP_REQUEST` |
| `method` | `HTTP` |
| `path` | `extism:host/env/http_request` |
| 方向 | 插件 → 网络 |
| 权限 | `permissions.http` 非空且命中白名单 |
| 请求 | Extism `HttpRequest` + 可选 body |
| 响应 | Extism `HttpResponse` |
| 限制 | 响应 ≤4 MiB；总调用 ≤10 秒 |
| 错误 | `E_PERMISSION_DENIED`（未命中白名单）、`E_PLUGIN_TRAP`（超时） |

请求结构：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 是 | 完整 URL；主机必须命中 `permissions.http` |
| `method` | string? | 否 | HTTP 方法，默认由 PDK/运行时决定 |
| `headers` | object<string,string> | 否 | 请求头 |

响应读取：

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `status_code()` | integer | HTTP 状态码 |
| `headers()` | object<string,string> | 响应头 |
| `body()` | bytes | 响应正文 |

```rust
use extism_pdk::{http, HttpRequest};

let request = HttpRequest::new("https://api.example.com/translate");
let response = http::request(&request, Some("{\"q\":\"annealing\"}"))?;
let status = response.status_code();
let body = response.body();
```

- 白名单只匹配主机名；重定向到非白名单主机同样会被拒绝。
- 宿主拒绝本机/私网字面量，但无法完全防御 DNS 重绑定，只应对可信插件开放网络。

### 6.8 `IPC.LIST_PLUGINS`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.LIST_PLUGINS` |
| `method` | `IPC` |
| `path` | `tauri://invoke/list_plugins` |
| 参数 | 无 |
| 返回 | `PluginInfo[]`（§7.9） |
| 错误 | 无 |

```ts
import { invoke } from "@tauri-apps/api/core";
const plugins = await invoke<PluginInfo[]>("list_plugins");
```

### 6.9 `IPC.INSPECT_PLUGIN`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.INSPECT_PLUGIN` |
| `method` | `IPC` |
| `path` | `tauri://invoke/inspect_plugin` |
| 参数 | `InspectPluginArgs` |
| 返回 | `PluginPreview`（§7.10） |
| 错误 | `E_INSTALL_ZIP`、`E_MANIFEST_*`（预览不实例化 WASM，无 `E_EXPORT_*`） |

参数：

| 字段 | 类型 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- | --- |
| `path` | string | 是 | ZIP 绝对路径 | `"C:/plugins/pkg.zip"` |

```ts
const preview = await invoke<PluginPreview>("inspect_plugin", {
  path: "C:/plugins/pkg.zip",
});
```

### 6.10 `IPC.IMPORT_PLUGIN`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.IMPORT_PLUGIN` |
| `method` | `IPC` |
| `path` | `tauri://invoke/import_plugin` |
| 参数 | `ImportPluginArgs` |
| 返回 | `PluginInfo`（§7.9） |
| 错误 | `E_INSTALL_*`、`E_INSTALL_CONFLICT`、`E_MANIFEST_*`、`E_EXPORT_*` |

参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | ZIP 绝对路径 |

```ts
const info = await invoke<PluginInfo>("import_plugin", { path });
```

- 覆盖安装会先注销旧服务、解析器与动态面板，再按新清单注册。
- 与已启用插件扩展名冲突时拒绝；返回的错误消息以 `扩展名冲突：` 开头。

### 6.11 `IPC.SET_PLUGIN_ENABLED`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.SET_PLUGIN_ENABLED` |
| `method` | `IPC` |
| `path` | `tauri://invoke/set_plugin_enabled` |
| 参数 | `SetPluginEnabledArgs` |
| 返回 | `PluginInfo[]` |
| 错误 | `E_PLUGIN_ENABLE_CONFLICT`、`E_MANIFEST_*`、`E_EXPORT_*` |

参数：

| 字段 | 类型 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 插件名 | `"my-plugin"` |
| `enabled` | boolean | 是 | 目标状态 | `true` |

```ts
const plugins = await invoke<PluginInfo[]>("set_plugin_enabled", {
  name: "my-plugin",
  enabled: true,
});
```

- 启用是事务性的：先实例化并检查冲突，再写 `enabled`；失败不会改变磁盘状态。
- 停用会注销翻译服务、解析器与动态面板；若它是当前翻译服务，设置回退到 `google`。

### 6.12 `IPC.REMOVE_PLUGIN`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.REMOVE_PLUGIN` |
| `method` | `IPC` |
| `path` | `tauri://invoke/remove_plugin` |
| 参数 | `RemovePluginArgs` |
| 返回 | `PluginInfo[]` |
| 错误 | `E_PLUGIN_NAME`、文件系统错误 |

参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 插件名 |

```ts
const plugins = await invoke<PluginInfo[]>("remove_plugin", { name });
```

### 6.13 `IPC.PLUGIN_README`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.PLUGIN_README` |
| `method` | `IPC` |
| `path` | `tauri://invoke/plugin_readme` |
| 参数 | `PluginReadmeArgs` |
| 返回 | `string`（Markdown；无 README 时 `""`） |
| 错误 | `E_PLUGIN_NAME` |

```ts
const markdown = await invoke<string>("plugin_readme", { name: "my-plugin" });
```

### 6.14 `IPC.PLUGIN_PANEL_CONTENT`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.PLUGIN_PANEL_CONTENT` |
| `method` | `IPC` |
| `path` | `tauri://invoke/plugin_panel_content` |
| 参数 | `PluginPanelContentArgs` |
| 返回 | `PanelSection[]`（§7.4） |
| 错误 | `E_PLUGIN_NOT_ENABLED`、`E_PANEL_UNKNOWN`、`E_PANEL_*` |

参数：

| 字段 | 类型 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 插件名 | `"stats-plugin"` |
| `panelId` | string | 是 | 动态面板 `id` | `"stats"` |

```ts
const sections = await invoke<PanelSection[]>("plugin_panel_content", {
  name: "stats-plugin",
  panelId: "stats",
});
```

### 6.15 `IPC.PARSE_DOCUMENT`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.PARSE_DOCUMENT` |
| `method` | `IPC` |
| `path` | `tauri://invoke/parse_document` |
| 参数 | `ParseDocumentArgs` |
| 返回 | `ParsedDocument`（§7.2） |
| 错误 | `E_DOC_NOT_CUSTOM`、`E_PARSER_NOT_FOUND`、`E_PLUGIN_CALL`、`E_PARSER_CONTRACT` |

参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 文库文档 ID |

```ts
const parsed = await invoke<ParsedDocument>("parse_document", { id: docId });
```

### 6.16 `IPC.OPEN_DOCUMENT`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.OPEN_DOCUMENT` |
| `method` | `IPC` |
| `path` | `tauri://invoke/open_document` |
| 参数 | `OpenDocumentArgs` |
| 返回 | `DocumentInfo`（§7.11） |
| 错误 | `E_DOC_UNSUPPORTED`、`E_PLUGIN_NAME` |

参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 文件绝对路径 |

匹配顺序：

1. 内置格式（`pdf`/`epub`/`docx`/`md`/`markdown`/`txt`/`text`）。
2. 已启用 parser 声明的扩展名。
3. 已启用 parser 的 `magic` 文件头签名。

命中自定义格式时，返回的 `DocumentInfo.kind` 为 `plugin:<extension>`。

### 6.17 `IPC.SET_PLUGIN_DOCUMENT`

| 元数据 | 值 |
| --- | --- |
| `interfaceId` | `IPC.SET_PLUGIN_DOCUMENT` |
| `method` | `IPC` |
| `path` | `tauri://invoke/set_plugin_document` |
| 参数 | `SetPluginDocumentArgs` |
| 返回 | `null` |
| 错误 | `E_DOC_TOO_LARGE`、`E_DOC_CONTEXT` |

参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `document` | `DocSnapshot \| null` | 是 | 当前文档快照；`null` 表示关闭/清空 |

```ts
await invoke("set_plugin_document", { document: null });
```

- 只有存在启用且声明 `docRead` 的插件时前端才发布快照。
- 快照最大 20,000 块 / 8 MiB；超限直接拒绝。

## 7. 数据模型

### 7.1 翻译

```json
// TranslateRequest
{ "raw": "The annealing process refines grains.", "targetLang": "zh-CN" }

// TranslateResponse
{ "result": "退火工艺细化了晶粒。" }
```

| 类型 | 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- | --- |
| `TranslateRequest` | `raw` | string | 是 | ≤1 MiB |
| `TranslateRequest` | `targetLang` | string | 是 | 非空 |
| `TranslateResponse` | `result` | string | 是 | ≤4 MiB；额外字段忽略 |

### 7.2 解析

```json
// ExtractRequest
{ "name": "paper.foo", "extension": "foo", "size": 4096 }

// ParsedDocument
{
  "title": "Paper",
  "notice": "由 Foo 解析器提取",
  "blocks": [
    { "kind": "heading", "text": "1 Introduction", "level": 1 },
    { "kind": "paragraph", "text": "Body", "level": 0 },
    { "kind": "figure", "text": "图 1", "image": "data:image/png;base64,AA==" }
  ]
}
```

`ParsedBlock.kind` 枚举：

| 值 | 含义 |
| --- | --- |
| `title` | 文档标题 |
| `heading` | 章节标题（`level` 有效） |
| `abstract` | 摘要 |
| `paragraph` | 正文（默认） |
| `note` | 注释 |
| `reference` | 单条参考文献 |
| `references` | 参考文献区 |
| `caption` | 图表标题（纯文本） |
| `meta` | 作者/机构等元信息 |
| `figure` | 图片（必须携带 `image`，`text` 为图注） |

### 7.3 动态面板

```json
// PanelRequest
{ "panelId": "stats" }

// PanelResponse
{ "sections": [{ "type": "paragraph", "text": "已解析 12 篇" }] }
```

### 7.4 `PanelSection`

```json
{ "type": "paragraph", "text": "说明" }
{ "type": "list", "items": ["A", "B"] }
{ "type": "keyValue", "items": [{ "key": "版本", "value": "1.0" }] }
```

| `type` | 字段 | 约束 |
| --- | --- | --- |
| `paragraph` | `text: string` | ≤16 KiB |
| `list` | `items: string[]` | ≤200 项，每项 ≤4 KiB |
| `keyValue` | `items: {key: string, value: string}[]` | ≤200 项，各字段 ≤4 KiB |

### 7.5 文件流

```json
// FileReadRequest（字段均可选）
{ "offset": 0, "limit": 65536 }

// FileReadResponse
{ "offset": 0, "data": "aGVsbG8=", "eof": false }
```

### 7.6 文档块

```json
// DocBlock
{ "id": 0, "kind": "paragraph", "text": "正文" }
```

### 7.7 文档快照

```json
// DocSnapshot
{ "title": "Paper", "blocks": [{ "id": 0, "kind": "paragraph", "text": "正文" }] }
```

### 7.8 文档读取

```json
// DocReadRequest（字段均可选）
{ "offset": 0, "limit": 100 }

// DocReadResponse
{
  "title": "Paper",
  "total": 2,
  "blocks": [{ "id": 0, "kind": "paragraph", "text": "正文" }],
  "truncated": true
}
```

### 7.9 `PluginInfo`

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "示例",
  "enabled": true,
  "apiVersion": 2,
  "kind": "translate",
  "permissions": { "docRead": false, "storage": true, "http": [] },
  "contributes": { "panels": [], "parsers": [] },
  "conflict": ".foo 已被插件「旧解析」使用"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 插件名 |
| `version` | string | 清单版本 |
| `description` | string | 简介 |
| `enabled` | boolean | 当前启用状态 |
| `apiVersion` | integer | 清单 API 版本 |
| `kind` | `translate \| panel \| parser \| other` | 插件类型 |
| `permissions` | `PluginPermissions` | 见 §4.2 |
| `contributes` | object | `{panels: PanelContribution[], parsers: ParserContribution[]}` |
| `conflict` | string? | 启动时因扩展名冲突被跳过的原因；无冲突时省略 |

`PanelContribution` / `ParserContribution` 字段与 §4.3、§4.4 完全一致。

### 7.10 `PluginPreview`

```json
{
  "info": { "...": "PluginInfo" },
  "digest": "64 位小写十六进制 SHA-256",
  "installed": null,
  "versionChange": "new",
  "conflicts": [{ "extension": "foo", "plugin": "旧解析" }]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `info` | `PluginInfo` | 待安装清单的只读信息 |
| `digest` | string | WASM 的 SHA-256（小写 hex） |
| `installed` | `PluginInfo \| null` | 同名的已安装版本 |
| `versionChange` | `new \| upgrade \| downgrade \| same \| different` | 版本变化 |
| `conflicts` | `ExtensionConflict[]` | 与其他启用插件的扩展名冲突 |

`ExtensionConflict`：`{ "extension": string, "plugin": string }`。

### 7.11 文档信息

```json
{
  "id": "…",
  "path": "C:/docs/paper.foo",
  "title": "paper",
  "kind": "plugin:foo",
  "tags": [],
  "collectionIds": []
}
```

`kind` 枚举：`pdf` / `epub` / `docx` / `markdown` / `text` / `plugin:<extension>`。

---

## 8. 错误目录

错误消息用于诊断；匹配时使用 `message includes <pattern>`。Error ID 仅用于文档归类与日志映射。

### 8.1 安装与清单

| Error ID | 触发 | 消息模式 | 处理 |
| --- | --- | --- | --- |
| `E_INSTALL_ZIP` | ZIP 结构非法 | `invalid zip archive` / `zip does not contain a plugin.json` / `multiple plugin.json` / `zip is missing wasm entry` | 修复包结构 |
| `E_MANIFEST_JSON` | 清单不是合法 JSON | `invalid plugin.json` | 修复 JSON |
| `E_MANIFEST_NAME` | 插件名非法 | `plugin name ...` | 见 §4.1 |
| `E_MANIFEST_VERSION` | 版本为空 | `plugin version must not be empty` | 填版本号 |
| `E_MANIFEST_ENTRY` | 入口名非法 | `invalid wasm entry` | 使用纯文件名 |
| `E_MANIFEST_API` | API 版本不支持 | `plugin apiVersion ... is not supported` | 改为 `1..=2` |
| `E_MANIFEST_KIND` | 类型未开放 | `该插件类型尚未开放` | 使用三类之一 |
| `E_MANIFEST_PERMISSION` | HTTP 主机非法 | `too many HTTP hosts` / `invalid HTTP host` / `wildcard-only` / `must not point at the local machine` | 收紧白名单 |
| `E_MANIFEST_PANEL` | 面板字段越界 | `too many contributed panels` / `invalid panel` / `panel content is too large` | 见 §4.3 |
| `E_MANIFEST_PARSER` | 解析声明越界 | `invalid parser id` / `invalid extension` / `duplicate parser extension` / `handled by a built-in reader` / `invalid magic` | 见 §4.4 |
| `E_INSTALL_CONFLICT` | 扩展名被其他启用插件占用 | `扩展名冲突：` | 停用/卸载冲突插件 |
| `E_INSTALL_PROBE` | 探针实例化失败 | `failed to instantiate wasm` | 检查 wasm 与限额 |
| `E_EXPORT_TRANSLATE_MISSING` | 翻译插件缺少导出 | `does not export a 'translate' function` | 导出 `translate` |
| `E_EXPORT_EXTRACT_MISSING` | 解析插件缺少导出 | `does not export an 'extract' function` | 导出 `extract` |
| `E_EXPORT_PANEL_MISSING` | 动态面板缺少导出 | `dynamic panels require a 'panel' export` | 导出 `panel` |

### 8.2 运行时

| Error ID | 触发 | 消息模式 | 可重试 |
| --- | --- | --- | --- |
| `E_PLUGIN_CALL` | 导出调用失败/陷阱 | `plugin translate call failed` / `parser plugin extract call failed` / `panel plugin call failed` | 否 |
| `E_PLUGIN_TRAP` | 超时、fuel 耗尽、内存超限 | 上述消息内含 `timeout` / `fuel` / `memory` 等运行时原因 | 否 |
| `E_PLUGIN_JSON` | 返回不是 JSON | `解析插件返回了无效 JSON` / `动态面板返回了无效 JSON` / serde 错误 | 否 |
| `E_PLUGIN_OUTPUT` | 返回过大 | `解析插件输出过大` / `plugin output is too large` / `动态面板返回的内容过大` | 否 |
| `E_PLUGIN_RESULT_MISSING` | 翻译返回结构错误 | `plugin returned no 'result' field` | 否 |
| `E_PARSER_CONTRACT` | 块/文本/图片不合规 | `未知块类型` / `文本过多` / `只有 figure 块可以携带图片` / `figure 块必须携带图片` / `图片必须是 data:image` / `图片数据不是有效的 base64` / `图片总大小过大` | 否 |
| `E_PERMISSION_DENIED` | 未声明能力 | `did not request the ... permission` | 否 |
| `E_STORAGE_KEY` | 键非法 | `invalid storage key` | 否 |
| `E_STORAGE_VALUE` | 单值过大 | `storage value too large` | 否 |
| `E_STORAGE_QUOTA` | 总配额超限 | `plugin storage quota exceeded` | 否 |
| `E_DOC_REQUEST` | 文档读取请求非法 | `invalid doc read request` | 否 |
| `E_DOC_CONTEXT` | 文档上下文不可用 | `document context unavailable` | 可重试（重新打开文档） |
| `E_FILE_SCOPE` | 非解析期读取文件 | `file access is only available while a document is parsed` / `parse scope is unavailable` | 否 |
| `E_FILE_REQUEST` | 文件读取请求非法 | `invalid file read request` | 否 |
| `E_FILE_IO` | 文件读取失败 | 操作系统 I/O 错误 | 可重试（重新打开文件） |
| `E_PANEL_UNKNOWN` | 面板不存在/非动态 | `面板不存在或不是动态面板` | 否 |
| `E_PANEL_JSON` | 面板返回非 JSON | `动态面板返回了无效 JSON` | 否 |
| `E_PANEL_OUTPUT` | 面板输出过大 | `动态面板返回的内容过大` | 否 |
| `E_PLUGIN_ENABLE_CONFLICT` | 启用时扩展名冲突 | `无法启用：` | 停用冲突插件后重试 |

### 8.3 文档与 IPC

| Error ID | 触发 | 消息模式 |
| --- | --- | --- |
| `E_DOC_UNSUPPORTED` | 无内置/插件可处理 | `unsupported file type: ...` |
| `E_PARSER_NOT_FOUND` | 找不到对应解析器 | `未找到可解析 .<ext> 的插件` |
| `E_DOC_NOT_CUSTOM` | 对内置文档调用解析 | `该文档不是插件解析格式` |
| `E_PLUGIN_NOT_ENABLED` | 动态面板插件未启用 | `未启用或没有动态面板` |
| `E_PLUGIN_NAME` | 插件名非法/路径穿越 | `plugin name must not ...` |
| `E_DOC_TOO_LARGE` | 文档快照超限 | `too many blocks` / `document text is too large` |
| `E_INSTALL_READ` | 读取插件包失败 | `failed to open plugin zip` / `failed to read plugin.json from zip` |

---

## 9. 运行上限

### 9.1 沙箱（所有插件）

| 资源 | 上限 | 常量 |
| --- | --- | --- |
| 单次调用 fuel | `2_000_000_000` | `CALL_FUEL` |
| 初始化 fuel | `8_000_000_000` | `INIT_FUEL` |
| 单次调用时长 | 10 秒 | `CALL_TIMEOUT` |
| 线性内存 | 1024 页 = 64 MiB | `MAX_MEMORY_PAGES` |
| WASM 文件 | 16 MiB | `MAX_WASM_BYTES` |
| Extism 变量 | 256 KiB | — |
| HTTP 响应 | 4 MiB | `MAX_OUTPUT_BYTES` |
| 翻译输入 | 1 MiB | `MAX_INPUT_BYTES` |
| 翻译输出 | 4 MiB | `MAX_OUTPUT_BYTES` |

### 9.2 能力

| 能力 | 上限 |
| --- | --- |
| 私有存储总量 | 1 MiB（按 `storage.json` 编码后大小） |
| 私有存储单值 | 64 KiB |
| 私有存储键 | 128 字节，非空，无控制字符 |
| 文档快照 | 20,000 块 / 8 MiB |
| 文档读取页 | 200 块 / 512 KiB |
| 单文件流式读取 | 64 MiB |
| 单次文件块 | 1 MiB |
| HTTP 主机白名单 | 32 项 |

### 9.3 解析输出

| 项 | 上限 |
| --- | --- |
| 块数量 | 20,000 |
| 文本总量 | 8 MiB |
| 标题 | 500 字节 |
| 提示 | 4096 字节 |
| 单张图片 | 2 MiB |
| 图片总量 | 16 MiB |
| 整体输出 | 4 MiB |

### 9.4 面板

| 项 | 上限 |
| --- | --- |
| 面板数量 | 8 |
| section 数量 | 32 |
| list/keyValue 条目 | 200 |
| paragraph 文本 | 16 KiB |
| 条目文本 | 4 KiB |
| 声明式内容总量 | 64 KiB |
| 动态输出 | 64 KiB |

## 10. 最佳实践

### 10.1 权限与清单

- 只申请实际使用的权限；`http: []` 表示完全禁网。
- 版本号使用 semver，升级时只增加向后兼容能力；破坏性变更提升主版本。
- 描述与 README 写清数据来源、许可证与网络目标。
- 一个扩展名只由一个插件声明；需要多格式时在同一个 parser 中声明多个扩展名。

### 10.2 解析插件

- 必须通过 `sr_file_read` 流式读取，不要假设存在完整文件内容。
- 以 `eof` 作为唯一终止条件；累加实际读取长度，不要用 `limit` 猜测进度。
- 先校验文件头/结构，再分配大块内存；损坏文件应尽早返回可读错误。
- 输出语义化块：标题用 `title`/`heading` 并给出正确 `level`，图注用 `figure` + `text`。
- 不要输出空块；阅读视图、大纲与逐段翻译都依赖块结构。
- 图片只嵌入 Data URL，并保持在单张 2 MiB / 合计 16 MiB 内。
- 不要把二进制内容直接塞进 `text`。

### 10.3 翻译插件

- 保留原文中的换行、标点与空白语义；逐段调用时 `raw` 已是段落级文本。
- 不依赖源语言字段；需要时自行检测。
- 网络失败时返回明确错误，不要把错误文本写进 `result`。
- 输出只包含 `result`，避免返回超大对象。

### 10.4 动态面板

- 面板生成应快速、只读、可重复；避免每次刷新都发起网络请求。
- 需要缓存时使用 `sr_storage_*`，并处理配额错误。
- 只返回文本 section；不要尝试输出 HTML、脚本或图片。
- `panelId` 必须与清单中的动态面板一一对应。

### 10.5 构建与发布

- `opt-level = "s"` + `lto = true` 控制体积；WASM 必须 ≤16 MiB。
- 打包前确认 `plugin.json.entry` 与实际文件名一致。
- 发布前用 `inspect_plugin` 检查权限、摘要与冲突。
- 保留示例包 `plugins/example-translate.zip` 作为端到端冒烟测试。

---

## 11. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 导入报缺少 `translate` | 未导出或函数名不是 `translate` | 使用 `#[plugin_fn] pub fn translate(...)` |
| 导入报缺少 `extract` | `kind:"parser"` 但未导出 `extract` | 导出 `extract` 或改 `kind` |
| 导入报缺少 `panel` | 有 `dynamic: true` 面板但未导出 `panel` | 导出 `panel` 或关闭 `dynamic` |
| 自定义文件打不开 | 插件未启用/扩展名拼写不一致/与其他插件冲突 | 检查启用状态、扩展名与 `conflict` 字段 |
| 打开对话框看不到目标文件 | 只有声明 `magic` 时才出现“所有文件” | 为 parser 声明 `magic`，或改用声明过的扩展名 |
| `magic` 不生效 | 签名不是偶数长度 hex / 超过 32 字节 / 不在偏移 0 | 修正签名；确认文件头字节 |
| 面板一直显示错误 | `panelId` 不匹配、返回非 JSON 或超过 64 KiB | 对照 §5.3 与 §7.3 |
| 图片不显示 | 不是 `data:image/...;base64`、超过 2 MiB、块类型不是 `figure` | 修正图片与块类型 |
| 调用能力报权限错误 | 清单未声明 `docRead`/`storage`/`http` | 增加权限并重新安装 |
| 翻译/解析超时 | 单次超过 10 秒或 fuel 耗尽 | 减少计算量、分块处理、避免同步大循环 |
| 存储写入失败 | 单值 >64 KiB 或总量 >1 MiB | 清理旧键或拆分存储 |
| 翻译结果为空/失败 | 返回缺少字符串 `result` | 返回 `{"result":"..."}` |
| 插件卡片显示“冲突” | 启动时扩展名已被其他插件占用 | 停用其中一个插件并重启/重新启用 |
| README 里的 HTML 不生效 | README 使用受限 Markdown | 改用标准 Markdown |
| 插件能读其他文件吗 | 不能；`sr_file_read` 只限当前解析文件 | 使用 `permissions.docRead` 读取当前文档文本 |
| 从哪里开始调试 | 先看应用日志中的 `[plugin:<name>]` | 使用 `sr_log` 输出关键步骤 |

---

## 12. 安全模型与治理

| 风险 | 缓解 |
| --- | --- |
| 越权读取文件 | WASM 无文件系统；`sr_file_read` 仅限当前解析文件；路径不暴露给插件 |
| 越权读取文档 | 只有 `permissions.docRead` 才能调用 `sr_doc_read`，且只含结构化文本 |
| 数据外泄 | HTTP 默认全禁；白名单最多 32 个主机；拒绝本机/私网字面量 |
| 资源耗尽 | fuel、内存页、10 秒超时、WASM 16 MiB、输出/图片/存储配额 |
| 扩展名劫持 | 内置格式不可覆盖；同一扩展名仅允许一个启用插件；冲突安装/启用被拒绝 |
| 恶意 UI 注入 | 静态/动态面板、README 只渲染文本或受限 Markdown，不执行 HTML/脚本 |
| 供应链替换 | 安装预览展示 SHA-256 与版本变化；同名升级原地替换并重新注册 |
| 权限升级 | 预览单独列出“新增权限/新增格式”，用户确认后才安装 |
| 插件卸载残留 | 卸载删除整个插件目录，并注销服务、解析器与动态面板 |

**信任模型**：当前不做密码学签名。`digest` 用于核对包内容是否变化，不证明来源。
只安装可信来源的插件；插件仓库与签名属于后续发布基础设施。

**残余风险**：HTTP 白名单只按主机名放行，无法完全防御 DNS 重绑定；只对可信插件开放网络。
错误消息可能包含文件路径等诊断信息，插件不应把宿主错误直接展示给最终用户。

---

## 13. 构建、打包与本地调试

### 13.1 工具链

```bash
rustup target add wasm32-unknown-unknown
```

### 13.2 编译与体积

```bash
cargo build --release --target wasm32-unknown-unknown
ls -lh target/wasm32-unknown-unknown/release/*.wasm
```

产物名是 crate 名中的 `-` 替换为 `_`。超过 16 MiB 会被拒绝安装。

### 13.3 打包

```bash
zip -j my-plugin.zip plugin.json \
  target/wasm32-unknown-unknown/release/my_plugin.wasm \
  README.md
```

### 13.4 本地迭代

- 参考 `plugins/example-translate/` 与 `plugins/build-example.sh`。
- `build-example.sh` 可直接把产物复制到插件目录，跳过 ZIP 导入，便于快速迭代。
- 正式发布仍走 ZIP 导入，以验证清单、权限与导出检查。
- 运行日志前缀：`[plugin:<name>]`，来源为 `sr_log`。

### 13.5 发布检查清单

- [ ] `plugin.json` 字段与 §4 一致，`entry` 与文件名一致
- [ ] WASM ≤16 MiB，导出函数齐全
- [ ] 只声明必要权限；HTTP 白名单最小化
- [ ] 解析插件用 `sr_file_read` 流式读取，输出块语义正确
- [ ] 图片均为 Data URL 且未超限
- [ ] 动态面板 `panelId` 与清单一致
- [ ] README 无依赖 HTML 的内容
- [ ] 通过 `inspect_plugin` 预览无冲突、无意外新增权限

## 14. 机器可读契约（JSON）

本节是单一事实来源（single source of truth）。AI / 代码生成器应**先解析本 JSON**，再按 `interfaceId`
回查对应章节。约定：

- `schemas` 使用 JSON Schema 子集：`type` / `properties` / `required` / `items` / `enum` / `const` /
  `oneOf` / `additionalProperties` / `$ref`，并扩展 `maxBytes` / `maxItems` / `minLength` / `default` /
  `pattern` / `contentEncoding`。`$ref` 形如 `#/schemas/<Name>`。
- `additionalProperties: false` 是**生成约束**：只允许产出已声明字段；未声明字段一律视为非法。
- 跨字段规则放在 `constraints` 数组（JSON Schema 无法表达的部分）。
- `errors` 中的 `messagePatterns` 用于 `message.includes(pattern)` 匹配；`id` 不出现在真实消息里。
- 所有字节上限均为**字节**（非字符）；`MiB = 1048576`、`KiB = 1024`。

```json
{
  "contractVersion": 2,
  "docVersion": "3.0.0",
  "hostApiVersion": 2,
  "apiVersionRange": [1, 2],
  "updatedAt": "2026-11-12",
  "runtime": "Extism 1.41 / Wasmtime 49 / Tauri 2",
  "naming": {
    "json": "camelCase",
    "rust": "snake_case",
    "lengthUnit": "bytes",
    "base64": "RFC4648-standard-with-padding",
    "image": "data-url-only",
    "enums": "case-sensitive",
    "errors": "string-message-no-code-field",
    "jsonInput": "single UTF-8 object, no trailing bytes"
  },
  "methods": {
    "EXPORT": { "pathFormat": "wasm://plugin/<export>", "direction": "host->plugin", "transport": "wasm-call" },
    "HOST_FN": { "pathFormat": "extism:host/user/<name>", "direction": "plugin->host", "transport": "extism-host-fn" },
    "HTTP": { "pathFormat": "extism:host/env/http_request", "direction": "plugin->network", "transport": "extism-http" },
    "IPC": { "pathFormat": "tauri://invoke/<command>", "direction": "frontend->host", "transport": "tauri-invoke" },
    "MANIFEST": { "pathFormat": "zip://plugin.json", "direction": "host", "transport": "zip-read" }
  },
  "kinds": ["translate", "panel", "parser"],
  "builtinExtensions": ["pdf", "epub", "docx", "md", "markdown", "txt", "text"],
  "interfaces": [
    {
      "interfaceId": "PLUGIN.TRANSLATE",
      "method": "EXPORT",
      "path": "wasm://plugin/translate",
      "direction": "host->plugin",
      "export": "translate",
      "requiredExport": true,
      "kinds": ["translate"],
      "permissions": [],
      "request": { "schema": "TranslateRequest", "contentType": "application/json", "encoding": "utf-8" },
      "response": { "schema": "TranslateResponse", "contentType": "application/json", "encoding": "utf-8" },
      "limits": { "inputBytes": 1048576, "outputBytes": 4194304, "timeoutSeconds": 10, "fuel": 2000000000 },
      "errors": ["E_EXPORT_TRANSLATE_MISSING", "E_PLUGIN_CALL", "E_PLUGIN_OUTPUT", "E_PLUGIN_JSON", "E_PLUGIN_RESULT_MISSING"],
      "docSection": "5.1"
    },
    {
      "interfaceId": "PLUGIN.EXTRACT",
      "method": "EXPORT",
      "path": "wasm://plugin/extract",
      "direction": "host->plugin",
      "export": "extract",
      "requiredExport": true,
      "kinds": ["parser"],
      "permissions": ["file-read-implicit"],
      "request": { "schema": "ExtractRequest", "contentType": "application/json", "encoding": "utf-8", "note": "no 'data' field; read bytes via HOST.SR_FILE_READ" },
      "response": { "schema": "ParsedDocument", "contentType": "application/json", "encoding": "utf-8" },
      "limits": { "fileBytes": 67108864, "chunkBytes": 1048576, "outputBytes": 4194304, "timeoutSeconds": 10, "fuel": 2000000000 },
      "errors": ["E_EXPORT_EXTRACT_MISSING", "E_FILE_SCOPE", "E_FILE_REQUEST", "E_FILE_IO", "E_PLUGIN_CALL", "E_PLUGIN_OUTPUT", "E_PLUGIN_JSON", "E_PARSER_CONTRACT"],
      "docSection": "5.2"
    },
    {
      "interfaceId": "PLUGIN.PANEL",
      "method": "EXPORT",
      "path": "wasm://plugin/panel",
      "direction": "host->plugin",
      "export": "panel",
      "requiredExport": true,
      "kinds": ["translate", "panel", "parser"],
      "requires": "at least one contributes.panels[] with dynamic=true",
      "permissions": [],
      "request": { "schema": "PanelRequest", "contentType": "application/json", "encoding": "utf-8" },
      "response": { "schema": "PanelResponse", "contentType": "application/json", "encoding": "utf-8" },
      "limits": { "outputBytes": 65536, "sections": 32, "timeoutSeconds": 10, "fuel": 2000000000 },
      "errors": ["E_EXPORT_PANEL_MISSING", "E_PANEL_UNKNOWN", "E_PANEL_OUTPUT", "E_PANEL_JSON", "E_PERMISSION_DENIED"],
      "docSection": "5.3"
    },
    {
      "interfaceId": "HOST.SR_DOC_READ",
      "method": "HOST_FN",
      "path": "extism:host/user/sr_doc_read",
      "direction": "plugin->host",
      "permissions": ["docRead"],
      "request": { "schema": "DocReadRequest", "contentType": "application/json", "encoding": "utf-8", "emptyBodyAllowed": true },
      "response": { "schema": "DocReadResponse", "contentType": "application/json", "encoding": "utf-8" },
      "limits": { "pageBlocks": 200, "pageBytes": 524288 },
      "errors": ["E_PERMISSION_DENIED", "E_DOC_REQUEST", "E_DOC_CONTEXT"],
      "docSection": "6.1"
    },
    {
      "interfaceId": "HOST.SR_STORAGE_GET",
      "method": "HOST_FN",
      "path": "extism:host/user/sr_storage_get",
      "direction": "plugin->host",
      "permissions": ["storage"],
      "request": { "args": [{ "name": "key", "type": "string", "required": true, "maxBytes": 128 }], "encoding": "utf-8" },
      "response": { "type": "string", "note": "stored value, or empty string when absent" },
      "errors": ["E_PERMISSION_DENIED", "E_STORAGE_KEY"],
      "docSection": "6.2"
    },
    {
      "interfaceId": "HOST.SR_STORAGE_SET",
      "method": "HOST_FN",
      "path": "extism:host/user/sr_storage_set",
      "direction": "plugin->host",
      "permissions": ["storage"],
      "request": { "args": [{ "name": "key", "type": "string", "required": true, "maxBytes": 128 }, { "name": "value", "type": "string", "required": true, "maxBytes": 65536 }], "encoding": "utf-8" },
      "response": { "type": "string", "const": "" },
      "limits": { "totalBytes": 1048576 },
      "errors": ["E_PERMISSION_DENIED", "E_STORAGE_KEY", "E_STORAGE_VALUE", "E_STORAGE_QUOTA"],
      "docSection": "6.3"
    },
    {
      "interfaceId": "HOST.SR_STORAGE_DELETE",
      "method": "HOST_FN",
      "path": "extism:host/user/sr_storage_delete",
      "direction": "plugin->host",
      "permissions": ["storage"],
      "request": { "args": [{ "name": "key", "type": "string", "required": true, "maxBytes": 128 }], "encoding": "utf-8" },
      "response": { "type": "string", "const": "" },
      "errors": ["E_PERMISSION_DENIED", "E_STORAGE_KEY", "E_STORAGE_QUOTA"],
      "docSection": "6.4"
    },
    {
      "interfaceId": "HOST.SR_FILE_READ",
      "method": "HOST_FN",
      "path": "extism:host/user/sr_file_read",
      "direction": "plugin->host",
      "permissions": ["file-read-implicit"],
      "availableOnlyDuring": "PLUGIN.EXTRACT",
      "request": { "schema": "FileReadRequest", "contentType": "application/json", "encoding": "utf-8", "emptyBodyAllowed": true },
      "response": { "schema": "FileReadResponse", "contentType": "application/json", "encoding": "utf-8" },
      "limits": { "chunkBytes": 1048576, "fileBytes": 67108864 },
      "errors": ["E_FILE_SCOPE", "E_FILE_REQUEST", "E_FILE_IO"],
      "docSection": "6.5"
    },
    {
      "interfaceId": "HOST.SR_LOG",
      "method": "HOST_FN",
      "path": "extism:host/user/sr_log",
      "direction": "plugin->host",
      "permissions": [],
      "request": { "args": [{ "name": "message", "type": "string", "required": true, "maxChars": 4096 }], "encoding": "utf-8" },
      "response": { "type": "string", "const": "" },
      "errors": [],
      "docSection": "6.6"
    },
    {
      "interfaceId": "HOST.HTTP_REQUEST",
      "method": "HTTP",
      "path": "extism:host/env/http_request",
      "direction": "plugin->network",
      "permissions": ["http"],
      "request": { "schema": "HttpRequest", "body": "optional-bytes" },
      "response": { "type": "HttpResponse", "members": { "statusCode": "integer", "headers": "object<string,string>", "body": "bytes" } },
      "limits": { "responseBytes": 4194304, "timeoutSeconds": 10, "maxHosts": 32 },
      "errors": ["E_PERMISSION_DENIED", "E_PLUGIN_TRAP"],
      "docSection": "6.7"
    },
    {
      "interfaceId": "IPC.LIST_PLUGINS",
      "method": "IPC",
      "path": "tauri://invoke/list_plugins",
      "direction": "frontend->host",
      "request": { "args": null },
      "response": { "schema": "PluginInfo", "isArray": true },
      "errors": [],
      "docSection": "6.8"
    },
    {
      "interfaceId": "IPC.INSPECT_PLUGIN",
      "method": "IPC",
      "path": "tauri://invoke/inspect_plugin",
      "direction": "frontend->host",
      "request": { "schema": "InspectPluginArgs" },
      "response": { "schema": "PluginPreview" },
      "note": "does not instantiate wasm; no E_EXPORT_* errors",
      "errors": ["E_INSTALL_READ", "E_INSTALL_ZIP", "E_MANIFEST_JSON", "E_MANIFEST_NAME", "E_MANIFEST_VERSION", "E_MANIFEST_ENTRY", "E_MANIFEST_API", "E_MANIFEST_KIND", "E_MANIFEST_PERMISSION", "E_MANIFEST_PANEL", "E_MANIFEST_PARSER"],
      "docSection": "6.9"
    },
    {
      "interfaceId": "IPC.IMPORT_PLUGIN",
      "method": "IPC",
      "path": "tauri://invoke/import_plugin",
      "direction": "frontend->host",
      "request": { "schema": "ImportPluginArgs" },
      "response": { "schema": "PluginInfo" },
      "errors": ["E_INSTALL_READ", "E_INSTALL_ZIP", "E_INSTALL_CONFLICT", "E_INSTALL_PROBE", "E_MANIFEST_JSON", "E_MANIFEST_NAME", "E_MANIFEST_VERSION", "E_MANIFEST_ENTRY", "E_MANIFEST_API", "E_MANIFEST_KIND", "E_MANIFEST_PERMISSION", "E_MANIFEST_PANEL", "E_MANIFEST_PARSER", "E_EXPORT_TRANSLATE_MISSING", "E_EXPORT_EXTRACT_MISSING", "E_EXPORT_PANEL_MISSING"],
      "docSection": "6.10"
    },
    {
      "interfaceId": "IPC.SET_PLUGIN_ENABLED",
      "method": "IPC",
      "path": "tauri://invoke/set_plugin_enabled",
      "direction": "frontend->host",
      "request": { "schema": "SetPluginEnabledArgs" },
      "response": { "schema": "PluginInfo", "isArray": true },
      "errors": ["E_PLUGIN_ENABLE_CONFLICT", "E_MANIFEST_JSON", "E_EXPORT_TRANSLATE_MISSING", "E_EXPORT_EXTRACT_MISSING", "E_EXPORT_PANEL_MISSING", "E_INSTALL_PROBE"],
      "docSection": "6.11"
    },
    {
      "interfaceId": "IPC.REMOVE_PLUGIN",
      "method": "IPC",
      "path": "tauri://invoke/remove_plugin",
      "direction": "frontend->host",
      "request": { "schema": "RemovePluginArgs" },
      "response": { "schema": "PluginInfo", "isArray": true },
      "errors": ["E_PLUGIN_NAME"],
      "docSection": "6.12"
    },
    {
      "interfaceId": "IPC.PLUGIN_README",
      "method": "IPC",
      "path": "tauri://invoke/plugin_readme",
      "direction": "frontend->host",
      "request": { "schema": "PluginReadmeArgs" },
      "response": { "type": "string", "note": "Markdown; empty string when no README" },
      "errors": ["E_PLUGIN_NAME"],
      "docSection": "6.13"
    },
    {
      "interfaceId": "IPC.PLUGIN_PANEL_CONTENT",
      "method": "IPC",
      "path": "tauri://invoke/plugin_panel_content",
      "direction": "frontend->host",
      "request": { "schema": "PluginPanelContentArgs" },
      "response": { "schema": "PanelSection", "isArray": true },
      "errors": ["E_PLUGIN_NOT_ENABLED", "E_PANEL_UNKNOWN", "E_PANEL_JSON", "E_PANEL_OUTPUT", "E_PLUGIN_CALL"],
      "docSection": "6.14"
    },
    {
      "interfaceId": "IPC.PARSE_DOCUMENT",
      "method": "IPC",
      "path": "tauri://invoke/parse_document",
      "direction": "frontend->host",
      "request": { "schema": "ParseDocumentArgs" },
      "response": { "schema": "ParsedDocument" },
      "errors": ["E_DOC_NOT_CUSTOM", "E_PARSER_NOT_FOUND", "E_PLUGIN_CALL", "E_PARSER_CONTRACT"],
      "docSection": "6.15"
    },
    {
      "interfaceId": "IPC.OPEN_DOCUMENT",
      "method": "IPC",
      "path": "tauri://invoke/open_document",
      "direction": "frontend->host",
      "request": { "schema": "OpenDocumentArgs" },
      "response": { "schema": "DocumentInfo" },
      "matchOrder": ["builtin-extension", "enabled-parser-extension", "enabled-parser-magic"],
      "errors": ["E_DOC_UNSUPPORTED", "E_PLUGIN_NAME"],
      "docSection": "6.16"
    },
    {
      "interfaceId": "IPC.SET_PLUGIN_DOCUMENT",
      "method": "IPC",
      "path": "tauri://invoke/set_plugin_document",
      "direction": "frontend->host",
      "request": { "schema": "SetPluginDocumentArgs" },
      "response": { "type": "null" },
      "limits": { "snapshotBlocks": 20000, "snapshotTextBytes": 8388608 },
      "errors": ["E_DOC_TOO_LARGE", "E_DOC_CONTEXT"],
      "docSection": "6.17"
    }
  ],
  "schemas": {
    "TranslateRequest": {
      "type": "object", "additionalProperties": false, "required": ["raw", "targetLang"],
      "properties": {
        "raw": { "type": "string", "maxBytes": 1048576 },
        "targetLang": { "type": "string", "minLength": 1 }
      },
      "note": "host does not send source language"
    },
    "TranslateResponse": {
      "type": "object", "additionalProperties": false, "required": ["result"],
      "properties": { "result": { "type": "string", "maxBytes": 4194304 } },
      "note": "host ignores extra fields, but generators must emit only result"
    },
    "ExtractRequest": {
      "type": "object", "additionalProperties": false, "required": ["name", "extension", "size"],
      "properties": {
        "name": { "type": "string", "note": "file name, no directory" },
        "extension": { "type": "string", "note": "matched parser extension, lowercase" },
        "size": { "type": "integer", "minimum": 0, "maximum": 67108864 }
      },
      "constraints": ["must not include a 'data' field"]
    },
    "ParsedDocument": {
      "type": "object", "additionalProperties": false, "required": ["blocks"],
      "properties": {
        "title": { "type": "string", "maxBytes": 500 },
        "notice": { "type": "string", "maxBytes": 4096 },
        "blocks": { "type": "array", "maxItems": 20000, "items": { "$ref": "#/schemas/ParsedBlock" } }
      },
      "constraints": ["total block text <= 8388608 bytes", "serialized output <= 4194304 bytes"]
    },
    "ParsedBlock": {
      "type": "object", "additionalProperties": false, "required": ["text"],
      "properties": {
        "kind": { "type": "string", "enum": ["title", "heading", "abstract", "paragraph", "note", "reference", "references", "caption", "meta", "figure"], "default": "paragraph" },
        "text": { "type": "string", "note": "caption when kind=figure" },
        "level": { "type": "integer", "minimum": 0, "maximum": 6, "default": 0 },
        "image": { "type": "string", "pattern": "^data:image/[A-Za-z0-9.+-]+;base64,", "maxBytes": 2097152, "note": "only for kind=figure" },
        "id": { "type": "integer", "readOnly": true, "note": "host-assigned; plugin value ignored" }
      },
      "constraints": ["kind=figure requires image", "kind!=figure must not include image", "total image bytes <= 16777216", "image payload must be valid base64"]
    },
    "PanelRequest": {
      "type": "object", "additionalProperties": false, "required": ["panelId"],
      "properties": { "panelId": { "type": "string", "note": "must match a dynamic=true panel id" } }
    },
    "PanelResponse": {
      "type": "object", "additionalProperties": false, "required": ["sections"],
      "properties": { "sections": { "type": "array", "maxItems": 32, "items": { "$ref": "#/schemas/PanelSection" } } },
      "constraints": ["serialized output <= 65536 bytes"]
    },
    "PanelSection": {
      "oneOf": [
        { "type": "object", "additionalProperties": false, "required": ["type", "text"], "properties": { "type": { "const": "paragraph" }, "text": { "type": "string", "maxBytes": 16384 } } },
        { "type": "object", "additionalProperties": false, "required": ["type", "items"], "properties": { "type": { "const": "list" }, "items": { "type": "array", "maxItems": 200, "items": { "type": "string", "maxBytes": 4096 } } } },
        { "type": "object", "additionalProperties": false, "required": ["type", "items"], "properties": { "type": { "const": "keyValue" }, "items": { "type": "array", "maxItems": 200, "items": { "type": "object", "additionalProperties": false, "required": ["key", "value"], "properties": { "key": { "type": "string", "maxBytes": 4096 }, "value": { "type": "string", "maxBytes": 4096 } } } } } }
      ]
    },
    "FileReadRequest": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "offset": { "type": "integer", "default": 0, "minimum": 0 },
        "limit": { "type": "integer", "default": 1048576, "minimum": 1, "maximum": 1048576 }
      }
    },
    "FileReadResponse": {
      "type": "object", "additionalProperties": false, "required": ["offset", "data", "eof"],
      "properties": {
        "offset": { "type": "integer" },
        "data": { "type": "string", "contentEncoding": "base64" },
        "eof": { "type": "boolean" }
      }
    },
    "DocBlock": {
      "type": "object", "additionalProperties": false, "required": ["id", "kind", "text"],
      "properties": { "id": { "type": "integer" }, "kind": { "type": "string" }, "text": { "type": "string" } }
    },
    "DocSnapshot": {
      "type": "object", "additionalProperties": false, "required": ["title", "blocks"],
      "properties": {
        "title": { "type": "string" },
        "blocks": { "type": "array", "maxItems": 20000, "items": { "$ref": "#/schemas/DocBlock" } }
      },
      "constraints": ["total text <= 8388608 bytes"]
    },
    "DocReadRequest": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "offset": { "type": "integer", "default": 0, "minimum": 0 },
        "limit": { "type": "integer", "default": 1, "minimum": 1, "maximum": 200 }
      }
    },
    "DocReadResponse": {
      "type": "object", "additionalProperties": false, "required": ["title", "total", "blocks", "truncated"],
      "properties": {
        "title": { "type": "string" },
        "total": { "type": "integer" },
        "blocks": { "type": "array", "items": { "$ref": "#/schemas/DocBlock" } },
        "truncated": { "type": "boolean" }
      }
    },
    "HttpRequest": {
      "type": "object", "additionalProperties": false, "required": ["url"],
      "properties": {
        "url": { "type": "string", "note": "host must match permissions.http" },
        "method": { "type": "string" },
        "headers": { "type": "object", "additionalProperties": { "type": "string" } }
      }
    },
    "PluginPermissions": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "docRead": { "type": "boolean", "default": false },
        "storage": { "type": "boolean", "default": false },
        "http": { "type": "array", "maxItems": 32, "default": [], "items": { "type": "string", "maxBytes": 253, "constraints": ["no wildcard-only host", "no localhost or private ranges"] } }
      }
    },
    "PanelContribution": {
      "type": "object", "additionalProperties": false, "required": ["id", "title"],
      "properties": {
        "id": { "type": "string", "minLength": 1, "maxBytes": 64, "pattern": "^[A-Za-z0-9_-]+$" },
        "title": { "type": "string", "minLength": 1, "maxBytes": 120 },
        "description": { "type": "string", "maxBytes": 500, "default": "" },
        "icon": { "type": "string", "enum": ["info", "list", "table", "book", "notes", "sparkle"], "default": "info" },
        "dynamic": { "type": "boolean", "default": false },
        "sections": { "type": "array", "maxItems": 32, "default": [], "items": { "$ref": "#/schemas/PanelSection" } }
      }
    },
    "ParserContribution": {
      "type": "object", "additionalProperties": false, "required": ["id", "extensions"],
      "properties": {
        "id": { "type": "string", "minLength": 1, "maxBytes": 64, "pattern": "^[A-Za-z0-9_-]+$" },
        "label": { "type": "string", "maxBytes": 80, "default": "" },
        "extensions": { "type": "array", "minItems": 1, "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxBytes": 16, "pattern": "^[A-Za-z0-9_-]+$", "constraints": ["must not be a built-in extension"] } },
        "magic": { "type": "array", "maxItems": 8, "default": [], "items": { "type": "string", "pattern": "^([0-9a-fA-F]{2})+$", "minBytes": 1, "maxBytes": 32 } }
      }
    },
    "Manifest": {
      "type": "object", "additionalProperties": false, "required": ["name", "version", "entry"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "constraints": ["no / \\ .. or control chars", "must not start with ."] },
        "version": { "type": "string", "minLength": 1 },
        "description": { "type": "string", "default": "" },
        "entry": { "type": "string", "minLength": 1, "constraints": ["plain file name; no / \\ .. :"] },
        "enabled": { "type": "boolean", "default": true },
        "apiVersion": { "type": "integer", "enum": [1, 2], "default": 1 },
        "kind": { "type": "string", "enum": ["translate", "panel", "parser"], "default": "translate" },
        "permissions": { "$ref": "#/schemas/PluginPermissions" },
        "contributes": { "type": "object", "additionalProperties": false, "properties": { "panels": { "type": "array", "maxItems": 8, "items": { "$ref": "#/schemas/PanelContribution" } }, "parsers": { "type": "array", "items": { "$ref": "#/schemas/ParserContribution" } } } }
      },
      "constraints": [
        "kind=translate requires 'translate' export",
        "kind=parser requires 'extract' export and >=1 parser; other kinds must not declare parsers",
        "kind=panel requires >=1 panel",
        "any dynamic=true panel requires 'panel' export",
        "total contributed text <= 65536 bytes",
        "extensions unique across all enabled plugins"
      ]
    },
    "PluginInfo": {
      "type": "object", "additionalProperties": false, "required": ["name", "version", "description", "enabled", "apiVersion", "kind", "permissions", "contributes"],
      "properties": {
        "name": { "type": "string" },
        "version": { "type": "string" },
        "description": { "type": "string" },
        "enabled": { "type": "boolean" },
        "apiVersion": { "type": "integer" },
        "kind": { "type": "string", "enum": ["translate", "panel", "parser", "other"] },
        "permissions": { "$ref": "#/schemas/PluginPermissions" },
        "contributes": { "type": "object", "properties": { "panels": { "type": "array", "items": { "$ref": "#/schemas/PanelContribution" } }, "parsers": { "type": "array", "items": { "$ref": "#/schemas/ParserContribution" } } } },
        "conflict": { "type": "string", "note": "host-set; omitted when no conflict" }
      }
    },
    "PluginPreview": {
      "type": "object", "additionalProperties": false, "required": ["info", "digest", "installed", "versionChange", "conflicts"],
      "properties": {
        "info": { "$ref": "#/schemas/PluginInfo" },
        "digest": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "installed": { "oneOf": [{ "$ref": "#/schemas/PluginInfo" }, { "type": "null" }] },
        "versionChange": { "type": "string", "enum": ["new", "upgrade", "downgrade", "same", "different"] },
        "conflicts": { "type": "array", "items": { "$ref": "#/schemas/ExtensionConflict" } }
      }
    },
    "ExtensionConflict": {
      "type": "object", "additionalProperties": false, "required": ["extension", "plugin"],
      "properties": { "extension": { "type": "string" }, "plugin": { "type": "string" } }
    },
    "DocumentInfo": {
      "type": "object", "additionalProperties": false, "required": ["id", "path", "title", "kind", "tags", "collectionIds"],
      "properties": {
        "id": { "type": "string" },
        "path": { "type": "string" },
        "title": { "type": "string" },
        "kind": { "type": "string", "note": "pdf | epub | docx | markdown | text | plugin:<extension>" },
        "tags": { "type": "array", "items": { "type": "string" } },
        "collectionIds": { "type": "array", "items": { "type": "string" } }
      }
    },
    "InspectPluginArgs": { "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string", "note": "absolute ZIP path" } } },
    "ImportPluginArgs": { "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string", "note": "absolute ZIP path" } } },
    "SetPluginEnabledArgs": { "type": "object", "additionalProperties": false, "required": ["name", "enabled"], "properties": { "name": { "type": "string" }, "enabled": { "type": "boolean" } } },
    "RemovePluginArgs": { "type": "object", "additionalProperties": false, "required": ["name"], "properties": { "name": { "type": "string" } } },
    "PluginReadmeArgs": { "type": "object", "additionalProperties": false, "required": ["name"], "properties": { "name": { "type": "string" } } },
    "PluginPanelContentArgs": { "type": "object", "additionalProperties": false, "required": ["name", "panelId"], "properties": { "name": { "type": "string" }, "panelId": { "type": "string" } } },
    "ParseDocumentArgs": { "type": "object", "additionalProperties": false, "required": ["id"], "properties": { "id": { "type": "string", "note": "library document id" } } },
    "OpenDocumentArgs": { "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string", "note": "absolute file path" } } },
    "SetPluginDocumentArgs": { "type": "object", "additionalProperties": false, "required": ["document"], "properties": { "document": { "oneOf": [{ "$ref": "#/schemas/DocSnapshot" }, { "type": "null" }] } } }
  },
  "limits": {
    "sandbox": { "callFuel": 2000000000, "initFuel": 8000000000, "callTimeoutSeconds": 10, "memoryPages": 1024, "memoryBytes": 67108864, "wasmBytes": 16777216, "extismVarsBytes": 262144, "httpResponseBytes": 4194304 },
    "translate": { "inputBytes": 1048576, "outputBytes": 4194304 },
    "storage": { "totalBytes": 1048576, "valueBytes": 65536, "keyBytes": 128 },
    "doc": { "snapshotBlocks": 20000, "snapshotTextBytes": 8388608, "pageBlocks": 200, "pageBytes": 524288 },
    "file": { "fileBytes": 67108864, "chunkBytes": 1048576 },
    "http": { "maxHosts": 32, "hostBytes": 253, "responseBytes": 4194304 },
    "parser": { "blocks": 20000, "textBytes": 8388608, "titleBytes": 500, "noticeBytes": 4096, "imageBytes": 2097152, "imageTotalBytes": 16777216, "outputBytes": 4194304, "levelRange": [0, 6] },
    "panel": { "count": 8, "sections": 32, "items": 200, "paragraphBytes": 16384, "itemBytes": 4096, "contributedBytes": 65536, "dynamicOutputBytes": 65536 },
    "log": { "maxChars": 4096 },
    "manifest": { "apiVersionRange": [1, 2], "panelIdBytes": 64, "panelTitleBytes": 120, "panelDescriptionBytes": 500, "parserIdBytes": 64, "parserLabelBytes": 80, "extensionBytes": 16, "extensionsPerParser": [1, 16], "magicCount": 8, "magicBytes": [1, 32] }
  },
  "errors": [
    { "id": "E_INSTALL_ZIP", "category": "install", "retryable": false, "messagePatterns": ["invalid zip archive", "zip does not contain a plugin.json", "multiple plugin.json", "zip is missing wasm entry"] },
    { "id": "E_INSTALL_READ", "category": "install", "retryable": false, "messagePatterns": ["failed to open plugin zip", "failed to read plugin.json from zip"] },
    { "id": "E_INSTALL_CONFLICT", "category": "install", "retryable": false, "messagePatterns": ["扩展名冲突："] },
    { "id": "E_INSTALL_PROBE", "category": "install", "retryable": false, "messagePatterns": ["failed to instantiate wasm"] },
    { "id": "E_MANIFEST_JSON", "category": "manifest", "retryable": false, "messagePatterns": ["invalid plugin.json"] },
    { "id": "E_MANIFEST_NAME", "category": "manifest", "retryable": false, "messagePatterns": ["plugin name"] },
    { "id": "E_MANIFEST_VERSION", "category": "manifest", "retryable": false, "messagePatterns": ["plugin version must not be empty"] },
    { "id": "E_MANIFEST_ENTRY", "category": "manifest", "retryable": false, "messagePatterns": ["invalid wasm entry"] },
    { "id": "E_MANIFEST_API", "category": "manifest", "retryable": false, "messagePatterns": ["is not supported"] },
    { "id": "E_MANIFEST_KIND", "category": "manifest", "retryable": false, "messagePatterns": ["该插件类型尚未开放"] },
    { "id": "E_MANIFEST_PERMISSION", "category": "manifest", "retryable": false, "messagePatterns": ["too many HTTP hosts", "invalid HTTP host", "wildcard-only", "must not point at the local machine"] },
    { "id": "E_MANIFEST_PANEL", "category": "manifest", "retryable": false, "messagePatterns": ["too many contributed panels", "invalid panel", "panel content is too large"] },
    { "id": "E_MANIFEST_PARSER", "category": "manifest", "retryable": false, "messagePatterns": ["invalid parser id", "invalid extension", "duplicate parser extension", "handled by a built-in reader", "invalid magic"] },
    { "id": "E_EXPORT_TRANSLATE_MISSING", "category": "export", "retryable": false, "messagePatterns": ["does not export a 'translate' function"] },
    { "id": "E_EXPORT_EXTRACT_MISSING", "category": "export", "retryable": false, "messagePatterns": ["does not export an 'extract' function"] },
    { "id": "E_EXPORT_PANEL_MISSING", "category": "export", "retryable": false, "messagePatterns": ["dynamic panels require a 'panel' export"] },
    { "id": "E_PLUGIN_CALL", "category": "runtime", "retryable": false, "messagePatterns": ["plugin translate call failed", "parser plugin extract call failed", "panel plugin call failed"] },
    { "id": "E_PLUGIN_TRAP", "category": "runtime", "retryable": false, "messagePatterns": ["timeout", "fuel", "memory"] },
    { "id": "E_PLUGIN_JSON", "category": "runtime", "retryable": false, "messagePatterns": ["解析插件返回了无效 JSON", "动态面板返回了无效 JSON"] },
    { "id": "E_PLUGIN_OUTPUT", "category": "runtime", "retryable": false, "messagePatterns": ["解析插件输出过大", "plugin output is too large", "动态面板返回的内容过大"] },
    { "id": "E_PLUGIN_RESULT_MISSING", "category": "runtime", "retryable": false, "messagePatterns": ["plugin returned no 'result' field"] },
    { "id": "E_PARSER_CONTRACT", "category": "runtime", "retryable": false, "messagePatterns": ["未知块类型", "文本过多", "只有 figure 块可以携带图片", "figure 块必须携带图片", "图片必须是 data:image", "图片数据不是有效的 base64", "图片总大小过大"] },
    { "id": "E_PERMISSION_DENIED", "category": "runtime", "retryable": false, "messagePatterns": ["did not request the", "permission"] },
    { "id": "E_STORAGE_KEY", "category": "runtime", "retryable": false, "messagePatterns": ["invalid storage key"] },
    { "id": "E_STORAGE_VALUE", "category": "runtime", "retryable": false, "messagePatterns": ["storage value too large"] },
    { "id": "E_STORAGE_QUOTA", "category": "runtime", "retryable": false, "messagePatterns": ["plugin storage quota exceeded"] },
    { "id": "E_DOC_REQUEST", "category": "runtime", "retryable": false, "messagePatterns": ["invalid doc read request"] },
    { "id": "E_DOC_CONTEXT", "category": "runtime", "retryable": true, "messagePatterns": ["document context unavailable"] },
    { "id": "E_FILE_SCOPE", "category": "runtime", "retryable": false, "messagePatterns": ["file access is only available while a document is parsed", "parse scope is unavailable"] },
    { "id": "E_FILE_REQUEST", "category": "runtime", "retryable": false, "messagePatterns": ["invalid file read request"] },
    { "id": "E_FILE_IO", "category": "runtime", "retryable": true, "messagePatterns": [] },
    { "id": "E_PANEL_UNKNOWN", "category": "runtime", "retryable": false, "messagePatterns": ["面板不存在或不是动态面板"] },
    { "id": "E_PANEL_JSON", "category": "runtime", "retryable": false, "messagePatterns": ["动态面板返回了无效 JSON"] },
    { "id": "E_PANEL_OUTPUT", "category": "runtime", "retryable": false, "messagePatterns": ["动态面板返回的内容过大"] },
    { "id": "E_PLUGIN_ENABLE_CONFLICT", "category": "runtime", "retryable": false, "messagePatterns": ["无法启用："] },
    { "id": "E_DOC_UNSUPPORTED", "category": "ipc", "retryable": false, "messagePatterns": ["unsupported file type:"] },
    { "id": "E_PARSER_NOT_FOUND", "category": "ipc", "retryable": false, "messagePatterns": ["未找到可解析"] },
    { "id": "E_DOC_NOT_CUSTOM", "category": "ipc", "retryable": false, "messagePatterns": ["该文档不是插件解析格式"] },
    { "id": "E_PLUGIN_NOT_ENABLED", "category": "ipc", "retryable": false, "messagePatterns": ["未启用或没有动态面板"] },
    { "id": "E_PLUGIN_NAME", "category": "ipc", "retryable": false, "messagePatterns": ["plugin name must not"] },
    { "id": "E_DOC_TOO_LARGE", "category": "ipc", "retryable": false, "messagePatterns": ["too many blocks", "document text is too large"] }
  ]
}
```

校验提示：把上面代码块内容保存为 `contract.json` 后应能通过 `JSON.parse`；`interfaces` 恰好 20 项，
`interfaceId` 与 §5、§6 一一对应。若本文档与代码实现出现分歧，以代码为准并回改本契约。
