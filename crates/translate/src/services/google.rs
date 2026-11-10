use crate::service::TranslateService;
use async_trait::async_trait;

/// Google translate web endpoint, same as the "google" service in
/// zotero-pdf-translate. No API key required.
pub struct GoogleService {
    client: reqwest::Client,
}

impl Default for GoogleService {
    fn default() -> Self {
        Self {
            client: super::http_client(),
        }
    }
}

#[async_trait]
impl TranslateService for GoogleService {
    fn id(&self) -> &str {
        "google"
    }

    fn name(&self) -> &str {
        "Google"
    }

    async fn translate(
        &self,
        raw: &str,
        source_lang: &str,
        target_lang: &str,
    ) -> anyhow::Result<String> {
        let sl = if source_lang == "auto" { "auto" } else { source_lang };
        let resp = self
            .client
            .get("https://translate.googleapis.com/translate_a/single")
            .query(&[
                ("client", "gtx"),
                ("sl", sl),
                ("tl", target_lang),
                ("dt", "t"),
                ("q", raw),
            ])
            .send()
            .await?
            .error_for_status()?;
        let data: serde_json::Value = resp.json().await?;
        let segments = data
            .get(0)
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("unexpected google response: {data}"))?;
        let mut out = String::new();
        for seg in segments {
            if let Some(s) = seg.get(0).and_then(|v| v.as_str()) {
                out.push_str(s);
            }
        }
        if out.is_empty() {
            anyhow::bail!("empty translation result");
        }
        Ok(out)
    }
}