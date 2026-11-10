use async_trait::async_trait;

/// Mirrors the TranslateService interface in zotero-pdf-translate
/// (src/modules/services/base.ts): each engine implements one method,
/// returns the translated text or an error so the registry can fall back.
#[async_trait]
pub trait TranslateService: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    async fn translate(
        &self,
        raw: &str,
        source_lang: &str,
        target_lang: &str,
    ) -> anyhow::Result<String>;
}