use anyhow::Context;
use async_trait::async_trait;
use scholarust_translate::TranslateService;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const PORT: u16 = 18712;
const START_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub running: bool,
    pub detail: String,
}

pub struct ModelManager {
    models_dir: PathBuf,
    child: Mutex<Option<Child>>,
    start_lock: Mutex<()>,
    ready: AtomicBool,
}

pub fn resolve_models_dir(data_dir: &Path) -> PathBuf {
    let mut candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("models"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("models"));
            candidates.push(dir.join("../../models"));
        }
    }
    candidates.push(data_dir.join("models"));
    for candidate in &candidates {
        if candidate.join("llama.cpp").is_dir() || candidate.join("hy-mt2-1.8b-gguf").is_dir() {
            return candidate.clone();
        }
    }
    candidates.into_iter().next().unwrap_or_else(|| PathBuf::from("models"))
}

fn find_gguf(models_dir: &Path) -> Option<PathBuf> {
    let dir = models_dir.join("hy-mt2-1.8b-gguf");
    for name in [
        "Hy-MT2-1.8B-Q8_0.gguf",
        "Hy-MT2-1.8B-Q6_K.gguf",
        "Hy-MT2-1.8B-Q4_K_M.gguf",
    ] {
        let path = dir.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    let entries = std::fs::read_dir(&dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
            return Some(path);
        }
    }
    None
}

impl ModelManager {
    pub fn layout_model_path(&self) -> PathBuf {
        self.models_dir
            .join("layout")
            .join("doclayout_yolo_docstructbench_imgsz1024.onnx")
    }

    pub fn new(models_dir: PathBuf) -> Self {
        Self {
            models_dir,
            child: Mutex::new(None),
            start_lock: Mutex::new(()),
            ready: AtomicBool::new(false),
        }
    }

    pub fn endpoint(&self) -> String {
        format!("http://127.0.0.1:{PORT}")
    }

    pub async fn status(&self) -> ModelStatus {
        let alive = {
            let mut child = self.child.lock().await;
            child.as_mut().map(|c| c.try_wait().ok().flatten()).flatten().is_none()
        };
        if self.ready.load(Ordering::Acquire) && alive {
            let model = find_gguf(&self.models_dir)
                .map(|p| p.file_name().unwrap_or_default().to_string_lossy().into_owned())
                .unwrap_or_default();
            return ModelStatus {
                running: true,
                detail: format!("llama-server @ 127.0.0.1:{PORT} (GPU offload, {model})"),
            };
        }
        let server = self.models_dir.join("llama.cpp").join("llama-server.exe");
        let detail = if !server.is_file() {
            format!("未找到推理引擎: {}", server.display())
        } else if find_gguf(&self.models_dir).is_none() {
            format!(
                "未找到 GGUF 模型文件: {}",
                self.models_dir.join("hy-mt2-1.8b-gguf").display()
            )
        } else {
            "未启动".into()
        };
        ModelStatus {
            running: false,
            detail,
        }
    }

    pub async fn ensure_started(self: &Arc<Self>) -> anyhow::Result<()> {
        if self.ready.load(Ordering::Acquire) {
            let mut child = self.child.lock().await;
            if let Some(c) = child.as_mut() {
                if c.try_wait()?.is_none() {
                    return Ok(());
                }
            }
            self.ready.store(false, Ordering::Release);
        }
        let _guard = self.start_lock.lock().await;
        if self.ready.load(Ordering::Acquire) {
            return Ok(());
        }

        let server = self.models_dir.join("llama.cpp").join("llama-server.exe");
        anyhow::ensure!(server.is_file(), "未找到推理引擎: {}", server.display());
        let gguf = find_gguf(&self.models_dir).with_context(|| {
            format!(
                "未找到 GGUF 模型: {}",
                self.models_dir.join("hy-mt2-1.8b-gguf").display()
            )
        })?;

        let mut cmd = Command::new(&server);
        cmd.arg("-m")
            .arg(&gguf)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(PORT.to_string())
            // 效率优化：全量 GPU offload + flash attention + 4 路并行连续批处理 + 常驻服务
            .arg("-ngl")
            .arg("99")
            .arg("--flash-attn")
            .arg("on")
            .arg("-c")
            .arg("16384")
            .arg("--parallel")
            .arg("4")
            .arg("--no-webui")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd.spawn().context("无法启动 llama-server")?;
        *self.child.lock().await = Some(child);

        let client = reqwest::Client::new();
        let url = format!("{}/health", self.endpoint());
        let deadline = tokio::time::Instant::now()
            + tokio::time::Duration::from_secs(START_TIMEOUT_SECS);
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    self.ready.store(true, Ordering::Release);
                    return Ok(());
                }
            }
            let still_alive = self
                .child
                .lock()
                .await
                .as_mut()
                .map(|c| c.try_wait().ok().flatten().is_none())
                .unwrap_or(false);
            anyhow::ensure!(still_alive, "llama-server 启动失败（进程已退出）");
            anyhow::ensure!(
                tokio::time::Instant::now() < deadline,
                "llama-server 启动超时（{START_TIMEOUT_SECS}s）"
            );
        }
    }

    pub async fn stop(&self) {
        self.ready.store(false, Ordering::Release);
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }
    }
}

pub struct HyMt2Service {
    manager: Arc<ModelManager>,
    client: reqwest::Client,
}

impl HyMt2Service {
    pub fn new(manager: Arc<ModelManager>) -> Self {
        Self {
            manager,
            client: reqwest::Client::new(),
        }
    }
}

fn language_name(code: &str) -> String {
    match code.split('-').next().unwrap_or(code) {
        "zh" => "Chinese",
        "en" => "English",
        "ja" => "Japanese",
        "ko" => "Korean",
        "fr" => "French",
        "de" => "German",
        "es" => "Spanish",
        "ru" => "Russian",
        "pt" => "Portuguese",
        "it" => "Italian",
        "ar" => "Arabic",
        other => return other.to_string(),
    }
    .to_string()
}

#[async_trait]
impl TranslateService for HyMt2Service {
    fn id(&self) -> &str {
        "hy-mt2"
    }

    fn name(&self) -> &str {
        "Hy-MT2 本地模型"
    }

    async fn translate(
        &self,
        raw: &str,
        _source_lang: &str,
        target_lang: &str,
    ) -> anyhow::Result<String> {
        self.manager.ensure_started().await?;
        let prompt = format!(
            "Translate the following segment into {}, without additional explanation.\n\n{}",
            language_name(target_lang),
            raw
        );
        let body = serde_json::json!({
            "model": "hy-mt2",
            "messages": [{ "role": "user", "content": prompt }],
            "temperature": 0.0,
            "max_tokens": 2048,
        });
        let url = format!("{}/v1/chat/completions", self.manager.endpoint());
        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("本地模型服务请求失败")?;
        anyhow::ensure!(
            resp.status().is_success(),
            "本地模型服务返回 {}",
            resp.status()
        );
        let json: serde_json::Value = resp.json().await?;
        json["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.trim().to_string())
            .ok_or_else(|| anyhow::anyhow!("本地模型返回格式异常: {json}"))
    }
}
