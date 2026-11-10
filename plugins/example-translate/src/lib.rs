use extism_pdk::*;
use serde_json::Value;

const GLOSSARY: &[(&str, &str)] = &[
    ("abstract", "摘要"),
    ("introduction", "引言"),
    ("conclusion", "结论"),
    ("references", "参考文献"),
    ("methodology", "方法论"),
    ("experiment", "实验"),
    ("dataset", "数据集"),
    ("framework", "框架"),
    ("neural network", "神经网络"),
    ("machine learning", "机器学习"),
    ("deep learning", "深度学习"),
    ("large language model", "大语言模型"),
    ("transformer", "Transformer 模型"),
    ("attention", "注意力机制"),
    ("benchmark", "基准测试"),
    ("baseline", "基线"),
    ("fine-tuning", "微调"),
    ("embedding", "嵌入"),
    ("token", "词元"),
    ("inference", "推理"),
    ("paper", "论文"),
    ("citation", "引用"),
];

#[plugin_fn]
pub fn translate(input: String) -> FnResult<String> {
    let value: Value = serde_json::from_str(&input)?;
    let raw = value.get("raw").and_then(|v| v.as_str()).unwrap_or("");
    let mut out = raw.to_string();
    for (en, zh) in GLOSSARY {
        let replaced = replace_case_insensitive(&out, en, zh);
        out = replaced;
    }
    Ok(serde_json::json!({ "result": out }).to_string())
}

fn replace_case_insensitive(text: &str, from: &str, to: &str) -> String {
    let lower = text.to_lowercase();
    let mut result = String::new();
    let mut cursor = 0;
    for (idx, _) in lower.match_indices(from) {
        result.push_str(&text[cursor..idx]);
        result.push_str(to);
        cursor = idx + from.len();
    }
    result.push_str(&text[cursor..]);
    result
}