use scholarust_core::Library;
use scholarust_plugin_host::PluginInfo;
use scholarust_translate::{OpenAIConfig, ServiceRegistry};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub target_lang: String,
    pub service: String,
    pub openai_endpoint: String,
    pub openai_model: String,
    pub openai_key: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            target_lang: "zh-CN".into(),
            service: "google".into(),
            openai_endpoint: "https://api.openai.com/v1".into(),
            openai_model: "gpt-4o-mini".into(),
            openai_key: String::new(),
        }
    }
}

impl Settings {
    pub fn load(file: &Path) -> Self {
        let mut settings: Self = std::fs::read_to_string(file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // The local model service was renamed from a model-specific id to a
        // generic one; migrate previously saved selections.
        if settings.service == "hy-mt2" {
            settings.service = "local-llm".into();
        }
        settings
    }

    pub fn save(&self, file: &Path) -> anyhow::Result<()> {
        std::fs::write(file, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn to_openai_config(&self) -> OpenAIConfig {
        OpenAIConfig {
            endpoint: self.openai_endpoint.clone(),
            model: self.openai_model.clone(),
            key: self.openai_key.clone(),
        }
    }
}

pub struct AppState {
    pub library: Mutex<Library>,
    pub registry: RwLock<ServiceRegistry>,
    pub settings: RwLock<Settings>,
    pub openai_config: Arc<RwLock<OpenAIConfig>>,
    pub plugins: Mutex<Vec<PluginInfo>>,
    pub data_dir: PathBuf,
    pub model: Arc<crate::model::ModelManager>,
}