use crate::service::TranslateService;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAIConfig {
    pub endpoint: String,
    pub model: String,
    pub key: String,
}

impl Default for OpenAIConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://api.openai.com/v1".into(),
            model: "gpt-4o-mini".into(),
            key: String::new(),
        }
    }
}

/// OpenAI-compatible chat completions, modeled on the gpt service in
/// zotero-pdf-translate. Works with OpenAI/DeepSeek/Moonshot/etc.
pub struct OpenAIService {
    client: reqwest::Client,
    config: Arc<RwLock<OpenAIConfig>>,
}

impl OpenAIService {
    pub fn new(config: Arc<RwLock<OpenAIConfig>>) -> Self {
        Self {
            client: super::http_client(),
            config,
        }
    }
}

#[async_trait]
impl TranslateService for OpenAIService {
    fn id(&self) -> &str {
        "openai"
    }

    fn name(&self) -> &str {
        "OpenAI 兼容 (GPT/DeepSeek)"
    }

    async fn translate(
        &self,
        raw: &str,
        _source_lang: &str,
        target_lang: &str,
    ) -> anyhow::Result<String> {
        let config = self.config.read().await.clone();
        if config.key.is_empty() {
            anyhow::bail!("未配置 API Key，请在右侧设置中填写 OpenAI 兼容接口密钥");
        }
        let url = format!(
            "{}/chat/completions",
            config.endpoint.trim_end_matches('/')
        );
        let body = serde_json::json!({
            "model": config.model,
            "temperature": 0.3,
            "messages": [
                {
                    "role": "system",
                    "content": format!(
                        "You are a professional academic translation engine. Translate the user's text into {target_lang}. Keep formulas, citations and proper nouns intact. Output only the translation, no explanations."
                    )
                },
                { "role": "user", "content": raw }
            ]
        });
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&config.key)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        let data: serde_json::Value = resp.json().await?;
        let text = data
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("unexpected LLM response: {data}"))?;
        Ok(text.trim().to_string())
    }
}