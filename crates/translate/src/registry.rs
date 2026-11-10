use crate::service::TranslateService;
use crate::task::{TaskStatus, TranslateResult, TranslateTask};
use futures::StreamExt;
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Default)]
pub struct ServiceRegistry {
    services: Vec<Arc<dyn TranslateService>>,
}

impl ServiceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, service: Arc<dyn TranslateService>) {
        self.services.retain(|s| s.id() != service.id());
        self.services.push(service);
    }

    /// Removes a service by id; returns whether anything was removed.
    pub fn unregister(&mut self, id: &str) -> bool {
        let before = self.services.len();
        self.services.retain(|s| s.id() != id);
        self.services.len() < before
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn TranslateService>> {
        self.services.iter().find(|s| s.id() == id).cloned()
    }

    pub fn list(&self) -> Vec<ServiceInfo> {
        self.services
            .iter()
            .map(|s| ServiceInfo {
                id: s.id().to_string(),
                name: s.name().to_string(),
            })
            .collect()
    }

    /// Same dispatch logic as TranslationServices.runTranslationTask in
    /// zotero-pdf-translate: detect language, try the chosen service, then
    /// fall back to candidates in order.
    pub async fn run_task(&self, task: &mut TranslateTask) {
        task.status = TaskStatus::Processing;
        if task.raw.trim().is_empty() {
            task.result = task.raw.clone();
            task.status = TaskStatus::Done;
            return;
        }
        if task.source_lang == "auto" {
            if let Some(lang) = detect_language(&task.raw) {
                task.source_lang = lang;
            }
        }
        if same_lang(&task.source_lang, &task.target_lang) {
            task.result = task.raw.clone();
            task.status = TaskStatus::Done;
            return;
        }

        let mut chain: Vec<String> = vec![task.service.clone()];
        chain.extend(task.candidate_services.iter().cloned());
        let mut last_error = String::from("no translation service available");
        for id in chain {
            let Some(service) = self.get(&id) else {
                last_error = format!("unknown service: {id}");
                continue;
            };
            match service
                .translate(&task.raw, &task.source_lang, &task.target_lang)
                .await
            {
                Ok(result) => {
                    task.result = result;
                    task.service = id;
                    task.status = TaskStatus::Done;
                    task.error = None;
                    return;
                }
                Err(err) => {
                    last_error = format!("{}: {err}", service.name());
                }
            }
        }
        task.status = TaskStatus::Failed;
        task.error = Some(last_error);
    }

    pub async fn translate_one(
        &self,
        raw: String,
        service: Option<&str>,
        target_lang: &str,
    ) -> TranslateResult {
        let service = service
            .filter(|s| !s.is_empty())
            .or_else(|| self.services.first().map(|s| s.id()))
            .unwrap_or("google")
            .to_string();
        let mut task = TranslateTask::new(raw, service, target_lang.to_string());
        self.run_task(&mut task).await;
        task.into_result()
    }

    /// Batch translation with bounded concurrency, order preserved.
    pub async fn translate_paragraphs(
        &self,
        paragraphs: Vec<String>,
        service: Option<&str>,
        target_lang: &str,
    ) -> Vec<TranslateResult> {
        futures::stream::iter(paragraphs.into_iter().map(|raw| async move {
            self.translate_one(raw, service, target_lang).await
        }))
        .buffered(3)
        .collect()
        .await
    }
}

/// whatlang returns ISO 639-3 codes; map the common ones to the codes
/// translation engines expect (BCP-47-ish).
pub fn detect_language(text: &str) -> Option<String> {
    let info = whatlang::detect(text)?;
    if info.is_reliable() {
        Some(map_lang(info.lang().code()))
    } else {
        None
    }
}

fn map_lang(code: &str) -> String {
    match code {
        "cmn" => "zh-CN",
        "eng" => "en",
        "jpn" => "ja",
        "kor" => "ko",
        "fra" => "fr",
        "deu" => "de",
        "spa" => "es",
        "rus" => "ru",
        "por" => "pt",
        "ita" => "it",
        "ara" => "ar",
        "tha" => "th",
        "vie" => "vi",
        "ind" => "id",
        other => other,
    }
    .to_string()
}

fn same_lang(a: &str, b: &str) -> bool {
    let base = |s: &str| {
        s.split('-')
            .next()
            .unwrap_or(s)
            .to_ascii_lowercase()
    };
    a != "auto" && base(a) == base(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::TranslateService;
    use async_trait::async_trait;

    struct EchoService(&'static str);

    #[async_trait]
    impl TranslateService for EchoService {
        fn id(&self) -> &str {
            self.0
        }
        fn name(&self) -> &str {
            self.0
        }
        async fn translate(
            &self,
            raw: &str,
            _source: &str,
            target: &str,
        ) -> anyhow::Result<String> {
            Ok(format!("[{}->{}] {}", self.0, target, raw))
        }
    }

    struct BrokenService;

    #[async_trait]
    impl TranslateService for BrokenService {
        fn id(&self) -> &str {
            "broken"
        }
        fn name(&self) -> &str {
            "broken"
        }
        async fn translate(
            &self,
            _raw: &str,
            _source: &str,
            _target: &str,
        ) -> anyhow::Result<String> {
            anyhow::bail!("always fails")
        }
    }

    #[test]
    fn unregister_removes_service() {
        let mut registry = ServiceRegistry::new();
        registry.register(Arc::new(EchoService("echo")));
        assert!(registry.unregister("echo"));
        assert!(!registry.unregister("echo"));
        assert!(registry.list().is_empty());
    }

    #[tokio::test]
    async fn falls_back_to_candidate_service() {
        let mut registry = ServiceRegistry::new();
        registry.register(Arc::new(BrokenService));
        registry.register(Arc::new(EchoService("echo")));
        let mut task = TranslateTask::new("hello".into(), "broken".into(), "zh-CN".into());
        task.source_lang = "en".into();
        task.candidate_services = vec!["echo".into()];
        registry.run_task(&mut task).await;
        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.service, "echo");
        assert_eq!(task.result, "[echo->zh-CN] hello");
    }

    #[tokio::test]
    async fn fails_when_all_services_fail() {
        let mut registry = ServiceRegistry::new();
        registry.register(Arc::new(BrokenService));
        let mut task = TranslateTask::new("hello".into(), "broken".into(), "zh-CN".into());
        task.source_lang = "en".into();
        registry.run_task(&mut task).await;
        assert_eq!(task.status, TaskStatus::Failed);
        assert!(task.error.is_some());
    }

    #[tokio::test]
    async fn skips_same_language() {
        let registry = ServiceRegistry::new();
        let mut task = TranslateTask::new("你好世界".into(), "google".into(), "zh-CN".into());
        task.source_lang = "zh".into();
        registry.run_task(&mut task).await;
        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.result, "你好世界");
    }

    #[tokio::test]
    async fn paragraphs_preserve_order() {
        let mut registry = ServiceRegistry::new();
        registry.register(Arc::new(EchoService("echo")));
        let input: Vec<String> = (0..10).map(|i| format!("p{i}")).collect();
        let results = registry
            .translate_paragraphs(input.clone(), Some("echo"), "zh-CN")
            .await;
        assert_eq!(results.len(), 10);
        for (i, r) in results.iter().enumerate() {
            assert_eq!(r.raw, input[i]);
            assert_eq!(r.result, format!("[echo->zh-CN] p{i}"));
        }
    }

    #[test]
    fn language_detection() {
        assert_eq!(
            detect_language("Recurrent neural networks have long been the dominant approach for sequence modeling tasks such as language modeling and machine translation. In this paper we propose a new architecture based entirely on attention mechanisms, dispensing with recurrence and convolutions.").as_deref(),
            Some("en")
        );
        assert_eq!(
            detect_language("我们提出了一种新的简单网络架构，完全基于注意力机制，摒弃了循环和卷积结构。实验结果表明，该模型在质量上优于以往的方法，同时更加易于并行训练。").as_deref(),
            Some("zh-CN")
        );
        assert_eq!(detect_language("ok"), None);
    }

    #[test]
    fn lang_base_comparison() {
        assert!(same_lang("zh", "zh-CN"));
        assert!(same_lang("en", "en"));
        assert!(!same_lang("auto", "zh-CN"));
        assert!(!same_lang("en", "zh-CN"));
    }
}