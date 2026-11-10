use crate::service::TranslateService;
use async_trait::async_trait;

/// MyMemory free API. Requires an explicit source language (no "auto"),
/// limited to ~500 bytes per request, so it works best as a fallback.
pub struct MyMemoryService {
    client: reqwest::Client,
}

impl Default for MyMemoryService {
    fn default() -> Self {
        Self {
            client: super::http_client(),
        }
    }
}

#[async_trait]
impl TranslateService for MyMemoryService {
    fn id(&self) -> &str {
        "mymemory"
    }

    fn name(&self) -> &str {
        "MyMemory"
    }

    async fn translate(
        &self,
        raw: &str,
        source_lang: &str,
        target_lang: &str,
    ) -> anyhow::Result<String> {
        let source = if source_lang == "auto" { "en" } else { source_lang };
        let langpair = format!("{source}|{target_lang}");
        let resp = self
            .client
            .get("https://api.mymemory.translated.net/get")
            .query(&[("q", raw), ("langpair", &langpair)])
            .send()
            .await?
            .error_for_status()?;
        let data: serde_json::Value = resp.json().await?;
        let text = data
            .pointer("/responseData/translatedText")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("unexpected mymemory response: {data}"))?;
        if text.contains("QUERY LENGTH LIMIT") || text.contains("INVALID") {
            anyhow::bail!("mymemory rejected the query: {text}");
        }
        Ok(text.to_string())
    }
}