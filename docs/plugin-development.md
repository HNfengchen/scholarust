# ScholaRust 插件开发指南

ScholaRust 的翻译能力可以通过**插件**扩展。插件是一个编译为 WebAssembly 的小程序，运行在
[Extism](https://extism.org) 沙箱里，向应用注册一个额外的翻译服务。这套机制对标
zotero-pdf-translate 的"自定义翻译服务"思路，但用 WASM 沙箱代替了直接执行 JS，安全性与语言无关性更好。

本文档面向想为 ScholaRust 编写翻译插件的开发者，覆盖：包格式、manifest 字段、`translate` 接口契约、
用 Rust 从零构建、打包、README 说明、安装与调试。

---

## 1. 插件能做什么

- 插件导出一个 `translate` 函数，应用把待翻译文本交给它，拿回译文。
- 导入后自动注册为翻译服务，服务 ID 固定为 `plugin:<插件名>`，出现在「翻译」面板的服务下拉里。
- 可在「扩展」面板**启用 / 停用 / 卸载**，也可点「详情」查看插件自带的 `README.md`。
- 典型用途：术语表替换、领域词典、调用某个在线翻译 API 的适配层、自定义后处理等。

> 插件运行在 Extism 沙箱中：启用了 WASI，但**不提供任何宿主回调函数**，默认无法访问应用内部状态、
> 本地文件系统或网络。需要联网的插件请在清单允许的范围内自行通过 WASI socket 实现（当前宿主未开放网络
> 权限，建议优先做纯本地逻辑，如术语/词典/格式化处理）。

---

## 2. 插件包格式（统一 ZIP）

**导入格式固定为 `.zip` 插件包**。压缩包内包含：

| 文件 | 必需 | 说明 |
| --- | --- | --- |
| `plugin.json` | ✅ | 插件清单，见 §3 |
| `<entry>.wasm` | ✅ | 清单 `entry` 指定的 WASM 入口，须导出 `translate` |
| `README.md` | 可选 | 插件说明文档，「详情」按钮会渲染它（Markdown） |

布局要求：

- 这些文件可以放在**压缩包根部**，也可以放在**单层根目录**内（例如 `my-plugin/plugin.json`）。
- 压缩包内必须**恰好一个** `plugin.json`；出现多个候选会被拒绝。
- `entry` 必须是**纯文件名**（不能含 `/`、`\`、`..`、`:`），且该文件必须真实存在于包内。
- 导入时宿主会先**实例化 WASM 并检查 `translate` 导出**，通过后才写入插件目录；无效包不会污染已安装插件。
- 同名插件再次导入会**原地升级**（替换旧目录）。

示例包结构（根部布局）：

```
my-plugin.zip
├── plugin.json
├── my_plugin.wasm
└── README.md
```

---

## 3. `plugin.json` 清单字段

```json
{
  "name": "材料专业英文术语",
  "version": "0.1.0",
  "description": "把材料科学英文术语替换为中文释义，覆盖金属/陶瓷/高分子/表征等方向",
  "entry": "materials_terms.wasm",
  "enabled": true
}
```

| 字段 | 类型 | 必需 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string | ✅ | — | 插件名，同时作为插件目录名与服务 ID 后缀。允许中文/Unicode |
| `version` | string | ✅ | — | 版本号，非空 |
| `description` | string | ❌ | `""` | 一句话简介，显示在插件卡片上 |
| `entry` | string | ✅ | — | WASM 入口文件名（纯文件名） |
| `enabled` | bool | ❌ | `true` | 导入后是否立即启用 |

**`name` 的约束**（宿主会校验，违反则拒绝安装）：

- 不能为空；
- 不能含路径分隔符 `/` 或 `\`；
- 不能含 `..`；
- 不能含控制字符；
- 不能以 `.` 开头。

这些约束保证 `name` 是一个安全的单段路径组件（插件安装在 `<数据目录>/plugins/<name>/`）。

---

## 4. `translate` 接口契约

插件必须导出一个名为 **`translate`** 的 Extism 函数：

- **输入**：一段 UTF-8 JSON 字符串，字段如下：

  ```json
  { "raw": "The annealing process refines the grain structure.", "targetLang": "zh-CN" }
  ```

  - `raw`：待翻译的原文（可能是一句话、一个段落或一个术语）。
  - `targetLang`：目标语言代码（如 `zh-CN`、`en`、`ja`）。
  - 注意：宿主**不**传入源语言字段，插件如需判断源语言请自行检测。

- **输出**：一段 UTF-8 JSON 字符串，**必须**含字符串字段 `result`：

  ```json
  { "result": "退火工艺细化了晶粒组织。" }
  ```

  - 缺少 `result` 字段或类型不对，宿主会报错并把该次翻译标记为失败。
  - `result` 即最终展示给用户的译文。

数据流：

```
应用 --(JSON {raw,targetLang})--> [WASM translate] --(JSON {result})--> 应用
```

---

## 5. 用 Rust 构建插件（完整示例）

推荐使用 Rust + [`extism-pdk`](https://crates.io/crates/extism-pdk)。任何能编译到 WASM 且提供
Extism PDK 的语言（Rust / Go / C / Zig 等）都可以，下面以 Rust 为例。

### 5.1 准备工具链

```bash
rustup target add wasm32-unknown-unknown
```

### 5.2 `Cargo.toml`

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
opt-level = "s"   # 优化体积，插件更小加载更快
```

### 5.3 `src/lib.rs`

```rust
use extism_pdk::*;
use serde_json::Value;

#[plugin_fn]
pub fn translate(input: String) -> FnResult<String> {
    // 1. 解析输入 JSON
    let value: Value = serde_json::from_str(&input)?;
    let raw = value.get("raw").and_then(|v| v.as_str()).unwrap_or("");
    let _target_lang = value.get("targetLang").and_then(|v| v.as_str()).unwrap_or("");

    // 2. 你的翻译/处理逻辑（这里是对原文做术语替换的示例）
    let out = raw.replace("annealing", "退火");

    // 3. 返回 {"result": "..."}
    Ok(serde_json::json!({ "result": out }).to_string())
}
```

要点：

- `#[plugin_fn]` 宏把函数导出为 Extism 可调用约定，函数名必须叫 `translate`。
- 入参/返回用 `String`（Extism PDK 自动处理内存与 UTF-8）。
- `FnResult<String>` 允许用 `?` 抛出错误；错误会使该次翻译失败。

### 5.4 编译

```bash
cargo build --release --target wasm32-unknown-unknown
# 产物：target/wasm32-unknown-unknown/release/my_plugin.wasm
```

> 注意产物文件名是 crate 名把 `-` 换成 `_`（`my-plugin` → `my_plugin.wasm`），
> `plugin.json` 的 `entry` 要与实际文件名一致。

---

## 6. 打包 ZIP

把 `plugin.json`、编译好的 `.wasm`、可选 `README.md` 放到同一目录，压缩为 ZIP（文件在根部即可）：

```bash
# 在插件目录内
zip -j ../my-plugin.zip plugin.json target/wasm32-unknown-unknown/release/my_plugin.wasm README.md
```

Windows 下也可用资源管理器选中三个文件 →「压缩为 ZIP」，或用任意压缩工具，只要保证：
`plugin.json` 在根部（或单层根目录内）、`entry` 文件名匹配。

仓库自带示例包 `plugins/example-translate.zip`（材料专业英文术语插件，内置 650 余条材料领域术语）可直接导入体验，其源码在 `plugins/example-translate/`。

---

## 7. `README.md`（插件说明）

- 在包内放一个 `README.md`，导入时会被一并安装到插件目录。
- 用户在「扩展」面板点该插件的「**详情**」按钮即可看到渲染后的 Markdown 说明。
- 建议写明：插件功能、术语/规则来源、支持的语言、版本变化、作者与许可。
- 安全提示：README 以**受限 Markdown** 渲染——原始 HTML 会被丢弃、链接仅允许 `http/https/mailto`，
  因此不要在 README 里依赖内嵌 HTML/脚本。
- 未附带 README 的插件，「详情」会显示"该插件未附带 README.md 说明"。

---

## 8. 安装、启用与使用

1. 打开右栏「**扩展**」面板 →「导入插件包（.zip）」→ 选择你的 ZIP。
2. 导入成功后自动注册为翻译服务（若 `enabled: true`），服务 ID 为 `plugin:<name>`。
3. 在「翻译」面板的服务下拉选择该插件，即可用它翻译。
4. 「扩展」面板可：
   - 勾选/取消以**启用/停用**（停用即从服务注册表移除）；
   - 点「**详情**」查看 README；
   - 点「**卸载**」删除插件目录及其服务。
5. 若当前选中的翻译服务正是要停用/卸载的插件，应用会自动回退到 `google`，避免设置指向失效服务。

插件安装位置：`<应用数据目录>/plugins/<name>/`（Windows 通常为
`%APPDATA%/com.scholarust.app/plugins/<name>/`）。

---

## 9. 调试与常见问题

- **导入报"does not export a 'translate' function"**：确认函数名恰为 `translate` 且用了 `#[plugin_fn]`；
  确认 `entry` 指向的是最新编译的 wasm。
- **导入报"invalid plugin.json"**：检查 JSON 语法、必填字段（`name`/`version`/`entry`）。
- **导入报"name/entry 非法"**：见 §3 的 `name` 约束与 `entry` 纯文件名要求。
- **翻译返回格式异常**：输出必须是含字符串 `result` 的 JSON，见 §4。
- **想快速本地验证**：可参考 `plugins/build-example.sh`，它把编译产物直接拷到插件目录（跳过 ZIP 导入），
  便于迭代；正式发布仍建议走 ZIP 导入流程。
- **体积优化**：`opt-level = "s"` + `lto = true`；避免引入庞大依赖。术语表类插件可把数据硬编码为常量。

---

## 10. 安全模型小结

- 插件在 Extism/WASM 沙箱内执行，内存隔离；宿主不注入任何回调函数。
- 安装前对 `name`、`entry` 做路径安全校验，防止目录穿越；对 WASM 先实例化探针再落盘。
- README 渲染丢弃原始 HTML、限制链接协议，避免存储型 XSS。
- 卸载即整目录删除，并同时从服务注册表移除对应服务。