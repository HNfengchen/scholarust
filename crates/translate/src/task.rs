use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Waiting,
    Processing,
    Done,
    Failed,
}

/// Mirrors TranslateTask in zotero-pdf-translate (src/utils/task.ts):
/// a unit of translation with fallback candidate services.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateTask {
    pub id: String,
    pub raw: String,
    pub result: String,
    pub source_lang: String,
    pub target_lang: String,
    pub service: String,
    pub candidate_services: Vec<String>,
    pub status: TaskStatus,
    pub error: Option<String>,
}

impl TranslateTask {
    pub fn new(raw: String, service: String, target_lang: String) -> Self {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        Self {
            id: format!("{ts}-{seq}"),
            raw,
            result: String::new(),
            source_lang: "auto".into(),
            target_lang,
            service,
            candidate_services: Vec::new(),
            status: TaskStatus::Waiting,
            error: None,
        }
    }

    pub fn into_result(self) -> TranslateResult {
        TranslateResult {
            raw: self.raw,
            result: self.result,
            error: self.error,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateResult {
    pub raw: String,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}