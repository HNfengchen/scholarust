use anyhow::Context;
use async_trait::async_trait;
use scholarust_translate::TranslateService;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const PORT: u16 = 18712;
const OCR_PORT: u16 = 18713;
const START_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub running: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    pub running: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrModelInfo {
    pub available: bool,
    pub model: String,
    pub mmproj: String,
    pub dir: String,
}

pub struct ModelManager {
    models_dir: PathBuf,
    child: Mutex<Option<Child>>,
    start_lock: Mutex<()>,
    ready: AtomicBool,
    ocr_child: Mutex<Option<Child>>,
    ocr_start_lock: Mutex<()>,
    ocr_ready: AtomicBool,
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
        if candidate.join("llama.cpp").is_dir()
            || candidate.join("layout").is_dir()
            || candidate.join("llm").is_dir()
            || find_gguf(candidate).is_some()
        {
            return candidate.clone();
        }
    }
    candidates.into_iter().next().unwrap_or_else(|| PathBuf::from("models"))
}

/// Recursively collects files whose extension matches `ext` (case-insensitive),
/// keeping the most recently modified one. Model files are discovered by
/// scanning rather than hard-coded names, so any GGUF / ONNX can be dropped in.
fn scan_newest(dir: &Path, ext: &str, recursive: bool, best: &mut Option<(SystemTime, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            if recursive {
                scan_newest(&path, ext, true, best);
            }
            continue;
        }
        let matches = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case(ext))
            .unwrap_or(false);
        if !matches {
            continue;
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let replace = match best {
            Some((current, _)) => modified > *current,
            None => true,
        };
        if replace {
            *best = Some((modified, path));
        }
    }
}

fn newest_with_ext(dir: &Path, ext: &str, recursive: bool) -> Option<PathBuf> {
    let mut best = None;
    scan_newest(dir, ext, recursive, &mut best);
    best.map(|(_, path)| path)
}

/// Prefers the dedicated `llm/` drop folder; falls back to scanning the whole
/// models tree so existing model subfolders keep working. When several GGUF
/// files exist, the most recently modified one wins.
fn find_gguf(models_dir: &Path) -> Option<PathBuf> {
    newest_with_ext(&models_dir.join("llm"), "gguf", true)
        .or_else(|| newest_with_ext(models_dir, "gguf", true))
}

fn files_with_ext(dir: &Path, ext: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            found.extend(files_with_ext(&path, ext));
            continue;
        }
        let matches = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case(ext))
            .unwrap_or(false);
        if matches {
            found.push(path);
        }
    }
    found
}

fn newest(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().max_by_key(|path| {
        path.metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    })
}

/// OCR needs a language model plus its multimodal projector (`*mmproj*.gguf`).
/// Each model keeps both files in its own subfolder under `ocr/`, and pairing
/// only happens inside one folder so weights from different models are never
/// mixed. A flat legacy layout (both files directly under `ocr/`) still works
/// because it forms a single folder group.
fn find_ocr_pair(models_dir: &Path) -> Option<(PathBuf, PathBuf)> {
    let files = files_with_ext(&models_dir.join("ocr"), "gguf");
    let is_mmproj = |path: &PathBuf| {
        path.file_name()
            .map(|name| name.to_string_lossy().to_lowercase().contains("mmproj"))
            .unwrap_or(false)
    };
    let mut groups: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for file in files {
        if let Some(dir) = file.parent() {
            groups.entry(dir.to_path_buf()).or_default().push(file);
        }
    }
    let mut best: Option<(SystemTime, PathBuf, PathBuf)> = None;
    for group in groups.into_values() {
        let (projectors, models): (Vec<_>, Vec<_>) = group.into_iter().partition(|path| is_mmproj(path));
        let (Some(model), Some(mmproj)) = (newest(models), newest(projectors)) else {
            continue;
        };
        let stamp = [&model, &mmproj]
            .iter()
            .filter_map(|path| path.metadata().and_then(|meta| meta.modified()).ok())
            .max()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        if best.as_ref().map(|(current, _, _)| stamp > *current).unwrap_or(true) {
            best = Some((stamp, model, mmproj));
        }
    }
    best.map(|(_, model, mmproj)| (model, mmproj))
}

impl ModelManager {
    pub fn layout_model_path(&self) -> PathBuf {
        let dir = self.models_dir.join("layout");
        newest_with_ext(&dir, "onnx", true).unwrap_or_else(|| dir.join("model.onnx"))
    }

    pub fn ocr_model_info(&self) -> OcrModelInfo {
        let dir = self.models_dir.join("ocr");
        let pair = find_ocr_pair(&self.models_dir);
        let file_name = |path: &Path| path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        OcrModelInfo {
            available: pair.is_some(),
            model: pair.as_ref().map(|(model, _)| file_name(model)).unwrap_or_default(),
            mmproj: pair.as_ref().map(|(_, mmproj)| file_name(mmproj)).unwrap_or_default(),
            dir: dir.to_string_lossy().into_owned(),
        }
    }

    pub fn new(models_dir: PathBuf) -> Self {
        Self {
            models_dir,
            child: Mutex::new(None),
            start_lock: Mutex::new(()),
            ready: AtomicBool::new(false),
            ocr_child: Mutex::new(None),
            ocr_start_lock: Mutex::new(()),
            ocr_ready: AtomicBool::new(false),
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
                self.models_dir.join("llm").display()
            )
        } else {
            "未启动".into()
        };
        ModelStatus {
            running: false,
            detail,
        }
    }

    /// Boots one `llama-server` instance and waits for its health endpoint.
    /// Translation and OCR each own a server and a model, so they can run at
    /// the same time without unloading each other.
    #[allow(clippy::too_many_arguments)]
    async fn ensure_server(
        &self,
        child_slot: &Mutex<Option<Child>>,
        start_lock: &Mutex<()>,
        ready: &AtomicBool,
        port: u16,
        model: &Path,
        mmproj: Option<&Path>,
        parallel: u32,
        flash_attn: bool,
        label: &str,
    ) -> anyhow::Result<()> {
        if ready.load(Ordering::Acquire) {
            let mut child = child_slot.lock().await;
            if let Some(c) = child.as_mut() {
                if c.try_wait()?.is_none() {
                    return Ok(());
                }
            }
            ready.store(false, Ordering::Release);
        }
        let _guard = start_lock.lock().await;
        if ready.load(Ordering::Acquire) {
            return Ok(());
        }

        let server = self.models_dir.join("llama.cpp").join("llama-server.exe");
        anyhow::ensure!(server.is_file(), "未找到推理引擎: {}", server.display());
        anyhow::ensure!(model.is_file(), "未找到{label}模型文件: {}", model.display());
        if let Some(mmproj) = mmproj {
            anyhow::ensure!(mmproj.is_file(), "未找到{label}文本投影文件: {}", mmproj.display());
        }

        let mut cmd = Command::new(&server);
        cmd.arg("-m")
            .arg(model)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            // 效率优化：全量 GPU offload + 常驻服务
            .arg("-ngl")
            .arg("99");
        if flash_attn {
            cmd.arg("--flash-attn").arg("on");
        }
        cmd.arg("-c")
            .arg(if mmproj.is_some() { "4096" } else { "16384" })
            .arg("--parallel")
            .arg(parallel.to_string())
            .arg("--no-webui");
        if let Some(mmproj) = mmproj {
            cmd.arg("--mmproj").arg(mmproj);
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::null());
        // Keep server diagnostics on disk: an opaque "process exited" is hard
        // to diagnose otherwise.
        let log_path = self.models_dir.join(format!("llama-server-{port}.log"));
        match std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
            Ok(file) => cmd.stderr(Stdio::from(file)),
            Err(_) => cmd.stderr(Stdio::null()),
        };
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd.spawn().with_context(|| format!("无法启动 {label} llama-server"))?;
        *child_slot.lock().await = Some(child);

        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:{port}/health");
        let deadline = tokio::time::Instant::now()
            + tokio::time::Duration::from_secs(START_TIMEOUT_SECS);
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    ready.store(true, Ordering::Release);
                    return Ok(());
                }
            }
            let still_alive = child_slot
                .lock()
                .await
                .as_mut()
                .map(|c| c.try_wait().ok().flatten().is_none())
                .unwrap_or(false);
            anyhow::ensure!(still_alive, "{label} llama-server 启动失败（进程已退出）");
            anyhow::ensure!(
                tokio::time::Instant::now() < deadline,
                "{label} llama-server 启动超时（{START_TIMEOUT_SECS}s）"
            );
        }
    }

    pub async fn ensure_started(&self) -> anyhow::Result<()> {
        let gguf = find_gguf(&self.models_dir).with_context(|| {
            format!(
                "未找到 GGUF 模型: {}",
                self.models_dir.join("llm").display()
            )
        })?;
        self.ensure_server(
            &self.child,
            &self.start_lock,
            &self.ready,
            PORT,
            &gguf,
            None,
            4,
            true,
            "翻译",
        )
        .await
    }

    pub async fn ensure_ocr_started(&self) -> anyhow::Result<()> {
        let (model, mmproj) = find_ocr_pair(&self.models_dir).with_context(|| {
            format!(
                "未找到 OCR 模型（主模型与 mmproj 需放在 {} 的同一个模型文件夹里）",
                self.models_dir.join("ocr").display()
            )
        })?;
        self.ensure_server(
            &self.ocr_child,
            &self.ocr_start_lock,
            &self.ocr_ready,
            OCR_PORT,
            &model,
            Some(&mmproj),
            1,
            false,
            "OCR",
        )
        .await
    }

    pub async fn ocr_status(&self) -> OcrStatus {
        let alive = {
            let mut child = self.ocr_child.lock().await;
            child.as_mut().map(|c| c.try_wait().ok().flatten()).flatten().is_none()
        };
        if self.ocr_ready.load(Ordering::Acquire) && alive {
            let model = find_ocr_pair(&self.models_dir)
                .map(|(model, _)| model.file_name().unwrap_or_default().to_string_lossy().into_owned())
                .unwrap_or_default();
            return OcrStatus {
                running: true,
                detail: format!("llama-server @ 127.0.0.1:{OCR_PORT} (OCR, {model})"),
            };
        }
        let server = self.models_dir.join("llama.cpp").join("llama-server.exe");
        let detail = if !server.is_file() {
            format!("未找到推理引擎: {}", server.display())
        } else if find_ocr_pair(&self.models_dir).is_none() {
            format!(
                "未找到 OCR 模型（主模型 + mmproj，需放在同一个模型文件夹）: {}",
                self.models_dir.join("ocr").display()
            )
        } else {
            "未启动".into()
        };
        OcrStatus {
            running: false,
            detail,
        }
    }

    /// Sends one page image to the OCR server and returns the transcribed text.
    pub async fn ocr_image(&self, image_base64: &str) -> anyhow::Result<String> {
        self.ensure_ocr_started().await?;
        let body = serde_json::json!({
            "model": "ocr",
            "messages": [
                {
                    "role": "system",
                    // The model is reasoning-capable: without this instruction it
                    // writes an analysis into reasoning_content and the actual
                    // transcription can come back empty.
                    "content": "You are an OCR assistant. Transcribe every piece of text in the image exactly, preserving paragraph breaks. Output only the transcribed text."
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": { "url": format!("data:image/png;base64,{image_base64}") }
                        },
                        { "type": "text", "text": "Read all the text in the image." }
                    ]
                }
            ],
            "temperature": 0.0,
            "max_tokens": 4096,
            // The model is reasoning-capable; without this it can spend the
            // whole reply on analysis and leave the transcription empty.
            "chat_template_kwargs": { "enable_thinking": false },
        });
        let url = format!("http://127.0.0.1:{OCR_PORT}/v1/chat/completions");
        let resp = reqwest::Client::new()
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("OCR 模型服务请求失败")?;
        anyhow::ensure!(resp.status().is_success(), "OCR 模型服务返回 {}", resp.status());
        let json: serde_json::Value = resp.json().await?;
        let message = &json["choices"][0]["message"];
        let content = message["content"].as_str().unwrap_or("").trim();
        if !content.is_empty() {
            return Ok(content.to_string());
        }
        // A thinking run can put the transcription into the reasoning channel.
        let reasoning = message["reasoning_content"].as_str().unwrap_or("").trim();
        if !reasoning.is_empty() {
            return Ok(reasoning.to_string());
        }
        let finish = json["choices"][0]["finish_reason"]
            .as_str()
            .unwrap_or("unknown");
        anyhow::bail!("OCR 模型未返回文字（finish_reason={finish}）")
    }

    pub async fn stop(&self) {
        self.ready.store(false, Ordering::Release);
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }
    }

    pub async fn stop_ocr(&self) {
        self.ocr_ready.store(false, Ordering::Release);
        if let Some(mut child) = self.ocr_child.lock().await.take() {
            let _ = child.kill().await;
        }
    }
}

pub struct LocalLlmService {
    manager: Arc<ModelManager>,
    client: reqwest::Client,
}

impl LocalLlmService {
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
impl TranslateService for LocalLlmService {
    fn id(&self) -> &str {
        "local-llm"
    }

    fn name(&self) -> &str {
        "本地模型"
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
            "model": "local-model",
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

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "scholarust-model-test-{tag}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let path = std::env::temp_dir().join(unique);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(dir: &Path, rel: &str, modified_secs: u64) -> PathBuf {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"x").unwrap();
        let time = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(modified_secs);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(time)
            .unwrap();
        path
    }

    #[test]
    fn find_gguf_prefers_llm_folder() {
        let tmp = TempDir::new("prefer-llm");
        let legacy = write(tmp.path(), "some-old-model/legacy.gguf", 100);
        let preferred = write(tmp.path(), "llm/new-model.gguf", 50);
        // Even though the legacy file is newer, the dedicated llm/ folder wins.
        assert_eq!(find_gguf(tmp.path()), Some(preferred));
        assert_ne!(find_gguf(tmp.path()), Some(legacy));
    }

    #[test]
    fn find_gguf_falls_back_to_recursive_scan() {
        let tmp = TempDir::new("fallback");
        let model = write(tmp.path(), "hy-mt2-1.8b-gguf/whatever-name.gguf", 100);
        assert_eq!(find_gguf(tmp.path()), Some(model));
    }

    #[test]
    fn find_gguf_picks_newest_within_folder() {
        let tmp = TempDir::new("newest");
        write(tmp.path(), "llm/old.gguf", 100);
        let newest = write(tmp.path(), "llm/new.gguf", 200);
        write(tmp.path(), "llm/mid.gguf", 150);
        assert_eq!(find_gguf(tmp.path()), Some(newest));
    }

    #[test]
    fn find_gguf_ignores_other_extensions_and_empty() {
        let tmp = TempDir::new("ignore");
        write(tmp.path(), "llm/notes.txt", 100);
        write(tmp.path(), "llm/model.onnx", 100);
        assert_eq!(find_gguf(tmp.path()), None);
        assert_eq!(find_gguf(&tmp.path().join("does-not-exist")), None);
    }

    #[test]
    fn find_gguf_case_insensitive_extension() {
        let tmp = TempDir::new("case");
        let model = write(tmp.path(), "llm/Model.GGUF", 100);
        assert_eq!(find_gguf(tmp.path()), Some(model));
    }

    #[test]
    fn ocr_pair_requires_model_and_mmproj() {
        let tmp = TempDir::new("ocr");
        // A model alone is not usable until its projector is present.
        write(tmp.path(), "ocr/main.gguf", 100);
        assert_eq!(find_ocr_pair(tmp.path()), None);
        let mmproj = write(tmp.path(), "ocr/MiniCPM.mmproj-bf16.gguf", 50);
        let model = write(tmp.path(), "ocr/MiniCPM.Q6_K.gguf", 150);
        assert_eq!(find_ocr_pair(tmp.path()), Some((model, mmproj)));
    }

    #[test]
    fn ocr_pair_picks_newest_of_each_role() {
        let tmp = TempDir::new("ocr-newest");
        write(tmp.path(), "ocr/old.gguf", 100);
        let model = write(tmp.path(), "ocr/new.gguf", 300);
        write(tmp.path(), "ocr/old-mmproj.gguf", 100);
        let mmproj = write(tmp.path(), "ocr/new.mmproj.gguf", 200);
        assert_eq!(find_ocr_pair(tmp.path()), Some((model, mmproj)));
    }

    #[test]
    fn ocr_pair_never_mixes_model_folders() {
        let tmp = TempDir::new("ocr-folders");
        let model = write(tmp.path(), "ocr/model-a/main.gguf", 100);
        let mmproj = write(tmp.path(), "ocr/model-a/model-a.mmproj.gguf", 100);
        // A newer model without a projector must not borrow another model's.
        write(tmp.path(), "ocr/model-b/main.gguf", 300);
        assert_eq!(find_ocr_pair(tmp.path()), Some((model, mmproj)));
        // Pairing works for a per-model folder layout too.
        let other_model = write(tmp.path(), "ocr/model-b/main.gguf", 400);
        let other_mmproj = write(tmp.path(), "ocr/model-b/model-b.mmproj.gguf", 500);
        assert_eq!(
            find_ocr_pair(tmp.path()),
            Some((other_model, other_mmproj))
        );
    }

    #[test]
    fn ocr_scan_stays_inside_ocr_folder() {
        let tmp = TempDir::new("ocr-scope");
        write(tmp.path(), "llm/translation.gguf", 100);
        write(tmp.path(), "ocr/only-model.gguf", 100);
        // The translation GGUF must never be picked up as an OCR model.
        assert_eq!(find_ocr_pair(tmp.path()), None);
    }

    #[test]
    fn layout_scan_finds_onnx_by_extension() {
        let tmp = TempDir::new("layout");
        let manager = ModelManager::new(tmp.path().to_path_buf());
        // No onnx yet: returns a placeholder that does not exist.
        assert!(!manager.layout_model_path().is_file());
        let onnx = write(tmp.path(), "layout/any-layout-model.onnx", 100);
        write(tmp.path(), "layout/readme.md", 200);
        assert_eq!(manager.layout_model_path(), onnx);
    }

    #[test]
    fn layout_scan_picks_newest_onnx() {
        let tmp = TempDir::new("layout-newest");
        let manager = ModelManager::new(tmp.path().to_path_buf());
        write(tmp.path(), "layout/old.onnx", 100);
        let newest = write(tmp.path(), "layout/new.onnx", 300);
        assert_eq!(manager.layout_model_path(), newest);
    }
}
