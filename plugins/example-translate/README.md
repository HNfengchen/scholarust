# 材料专业英文术语插件

一个运行在 Extism WASM 沙箱中的翻译服务插件，面向材料科学与工程领域的英文文献阅读。它内置一份覆盖主流子学科的专业术语表，把文中出现的英文术语就地替换为规范中文译名，帮助快速扫读论文、报告与教材。

> 这是基于词典的术语替换插件，**不是全文机器翻译**：只翻译命中术语表的词条，其余文字原样保留，因此不会破坏原文句式，也不会产生联网请求。

## 术语覆盖

内置 650 余条术语，按主题组织，涵盖：

- **晶体结构与晶体学**：晶格、晶胞、密勒指数、体心/面心立方、密排六方、布拉格定律、倒易点阵等
- **晶体缺陷**：空位、位错（刃型/螺型）、伯格斯矢量、层错、孪晶、滑移系、加工硬化等
- **扩散**：菲克定律、扩散系数、激活能、柯肯达尔效应等
- **相图与相变**：共晶/共析/包晶、液相线/固相线、马氏体/奥氏体/铁素体/珠光体/贝氏体、形核、再结晶、时效、析出强化等
- **力学性能**：屈服强度、抗拉强度、弹性模量、断裂韧性、疲劳、蠕变、硬度、应力强度因子、霍尔-佩奇关系等
- **热处理**：退火、淬火、回火、正火、渗碳/渗氮、固溶处理、TTT/CCT 图等
- **表征与测试**：SEM/TEM/AFM、XRD/XPS/EDS/EBSD、拉曼、DSC/TGA/DMA、布氏/洛氏/维氏硬度、纳米压痕等
- **金属与合金**：钢/铸铁/不锈钢、高温合金、钛合金/铝合金、形状记忆合金、高熵合金、金属玻璃等
- **陶瓷与无机非金属**：氧化铝/氧化锆/碳化硅/氮化硅、烧结、热等静压、压电/铁电/介电、半导体等
- **高分子**：玻璃化转变温度、结晶度、交联、硫化、数均/重均分子量、聚乙烯/环氧树脂/聚氨酯等
- **复合材料**：基体/增强体、碳纤维/玻璃纤维、预浸料、层合板、金属基/陶瓷基/聚合物基复合材料、界面、分层等
- **纳米材料与薄膜**：碳纳米管、石墨烯、量子点、CVD/PVD/ALD、溶胶-凝胶、外延等
- **腐蚀与防护**：点蚀/晶间腐蚀/应力腐蚀开裂、钝化、阴极保护、阳极氧化等
- **加工与制造**：铸造/锻造/轧制/焊接、增材制造、粉末冶金、搅拌摩擦焊等
- **物理性能**：热导率/电导率、热膨胀系数、铁磁/顺磁/抗磁、居里温度、介电常数、能带结构等

## 匹配规则

- **大小写不敏感**：`Dislocation`、`DISLOCATION`、`dislocation` 均命中。
- **最长优先**：在同一位置优先匹配最长术语，`yield strength` 译为「屈服强度」而非「屈服 强度」，`glass transition temperature` 译为「玻璃化转变温度」。
- **词边界保护**：只匹配完整词/词组，不会把 `stressful` 里的 `stress` 误译。
- **复数兼容**：自动识别词尾 `s`/`es`，`dislocations`、`alloys`、`stresses` 同样命中。
- **空白容错**：术语内部空格可对应原文任意连续空白（含换行），跨行的 `grain\nboundary` 也能命中。
- **原文保留**：未命中的文字、标点、已有中文一律原样保留。

## 翻译契约

插件导出 `translate` 函数，遵循 ScholaRust 统一翻译服务协议：

- 输入：JSON 字符串 `{"raw": "<原文>", "targetLang": "zh"}`
- 输出：JSON 字符串 `{"result": "<术语替换后的文本>"}`

`targetLang` 目前仅支持中文译名（术语表为英→中）。

## 构建与打包

需要 Rust 与 `wasm32-unknown-unknown` 目标：

```bash
rustup target add wasm32-unknown-unknown
cd plugins/example-translate
cargo build --release --target wasm32-unknown-unknown
```

把 `plugin.json`、构建产物 `target/wasm32-unknown-unknown/release/example_translate.wasm` 与本 `README.md` 一起压缩为 ZIP（三者位于包根部）：

```bash
powershell -Command "Compress-Archive -Path plugin.json, target/wasm32-unknown-unknown/release/example_translate.wasm, README.md -DestinationPath example-translate.zip -Force"
```

仓库已附带打包好的 `plugins/example-translate.zip`，可在应用右栏「扩展」面板直接导入。

## 测试

匹配逻辑带有单元测试（在宿主目标上运行，无需 wasm）：

```bash
cargo test
```

## 扩展术语表

术语表是 `src/lib.rs` 中的 `GLOSSARY` 常量数组，按主题分组。新增词条只需追加 `("英文", "中文")` 一行；多词条用空格分隔。重新构建并打包即可生效。

## 安全模型

插件以 Extism WASM 沙箱运行，宿主不向其暴露任何主机函数（无文件、无网络访问），仅通过 `translate` 函数传入/传出 JSON。术语表硬编码在模块内，运行期不读取外部资源。