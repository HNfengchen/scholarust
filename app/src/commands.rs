use crate::state::{AppState, Settings};
use scholarust_core::{markdown, DocumentInfo, DocumentKind};
use scholarust_plugin_host::{
    claims_magic, DocSnapshot, LoadedParser, PanelActionResponse, PanelSection, ParsedDocument,
    ParserContribution, PluginHost, PluginInfo, PluginPreview, MAX_DOC_BLOCKS, MAX_DOC_TEXT_BYTES,
};
use scholarust_translate::{ServiceInfo, TranslateResult};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn read_head(path: &Path, max: usize) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    let mut buffer = vec![0u8; max];
    let mut read = 0usize;
    while read < max {
        let count = file.read(&mut buffer[read..])?;
        if count == 0 {
            break;
        }
        read += count;
    }
    buffer.truncate(read);
    Ok(buffer)
}

/// Finds an enabled parser whose magic signature matches the file header.
async fn magic_parser(state: &AppState, path: &Path) -> Option<(LoadedParser, String)> {
    let head = read_head(path, 64).ok()?;
    if head.is_empty() {
        return None;
    }
    let parsers = state.parsers.lock().await;
    parsers
        .iter()
        .find(|parser| claims_magic(&parser.claims, &head))
        .map(|parser| {
            let extension = parser
                .claims
                .iter()
                .flat_map(|claim| claim.extensions.iter())
                .next()
                .cloned()
                .unwrap_or_default();
            (parser.clone(), extension)
        })
}

async fn extension_conflicts_for(
    state: &AppState,
    name: &str,
    candidate: &[ParserContribution],
) -> Vec<String> {
    let parsers = state.parsers.lock().await;
    let mut conflicts: Vec<String> = Vec::new();
    for claim in candidate {
        for extension in &claim.extensions {
            if let Some(other) = parsers
                .iter()
                .find(|parser| parser.info.name != name && parser.claims_extension(extension))
            {
                let message = format!(".{extension} 已被插件「{}」使用", other.info.name);
                if !conflicts.contains(&message) {
                    conflicts.push(message);
                }
            }
        }
    }
    conflicts
}

#[tauri::command]
pub async fn list_documents(state: State<'_, AppState>) -> Result<Vec<DocumentInfo>, String> {
    Ok(state.library.lock().await.documents.clone())
}

#[tauri::command]
pub async fn open_document(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<DocumentInfo, String> {
    let source = Path::new(&path);
    let doc = match DocumentInfo::from_path(source) {
        Ok(doc) => doc,
        Err(builtin_error) => {
            let extension = source
                .extension()
                .and_then(|ext| ext.to_str())
                .map(str::to_ascii_lowercase)
                .unwrap_or_default();
            let supported = if extension.is_empty() {
                false
            } else {
                state
                    .parsers
                    .lock()
                    .await
                    .iter()
                    .any(|parser| parser.claims_extension(&extension))
            };
            let kind = if supported {
                DocumentKind::Custom(extension)
            } else if let Some((_, parser_extension)) = magic_parser(state.inner(), source).await {
                DocumentKind::Custom(parser_extension)
            } else {
                return Err(builtin_error.to_string());
            };
            DocumentInfo::from_path_with_kind(source, kind).map_err(err)?
        }
    };
    app.asset_protocol_scope()
        .allow_file(&doc.path)
        .map_err(err)?;
    let mut library = state.library.lock().await;
    let doc = library.add(doc);
    library.save().map_err(err)?;
    Ok(doc)
}

#[tauri::command]
pub async fn remove_document(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut library = state.library.lock().await;
    library.remove(&id);
    library.save().map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPayload {
    pub kind: scholarust_core::DocumentKind,
    pub html: Option<String>,
    /// The untouched source text, for showing Markdown / plain text verbatim.
    pub raw: Option<String>,
    pub path: String,
}

#[tauri::command]
pub async fn get_content(
    state: State<'_, AppState>,
    id: String,
) -> Result<ContentPayload, String> {
    let library = state.library.lock().await;
    let doc = library
        .get(&id)
        .ok_or_else(|| format!("document not found: {id}"))?;
    let (html, raw) = match doc.kind {
        scholarust_core::DocumentKind::Markdown => {
            let source = std::fs::read_to_string(&doc.path).map_err(err)?;
            (Some(markdown::render_markdown(&source)), Some(source))
        }
        scholarust_core::DocumentKind::Text => {
            let source = std::fs::read_to_string(&doc.path).map_err(err)?;
            (Some(markdown::render_text(&source)), Some(source))
        }
        _ => (None, None),
    };
    Ok(ContentPayload {
        kind: doc.kind.clone(),
        html,
        raw,
        path: doc.path.clone(),
    })
}

#[tauri::command]
pub async fn list_services(state: State<'_, AppState>) -> Result<Vec<ServiceInfo>, String> {
    Ok(state.registry.read().await.list())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.settings.read().await.clone())
}

#[tauri::command]
pub async fn set_settings(state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    settings
        .save(&state.data_dir.join("settings.json"))
        .map_err(err)?;
    *state.openai_config.write().await = settings.to_openai_config();
    *state.settings.write().await = settings;
    Ok(())
}

/// Applies enabled middleware plugins (e.g. terminology cleanup) to results,
/// keeping the primary service's text whenever a middleware fails.
async fn apply_middlewares(
    state: &AppState,
    results: Vec<TranslateResult>,
    target: &str,
) -> Vec<TranslateResult> {
    let middlewares = state.middlewares.lock().await.clone();
    if middlewares.is_empty() {
        return results;
    }
    let mut out = Vec::with_capacity(results.len());
    for mut result in results {
        if result.error.is_none() {
            for middleware in &middlewares {
                match middleware.apply(&result.result, target).await {
                    Ok(rewritten) => result.result = rewritten,
                    Err(err) => eprintln!("middleware {} failed: {err}", middleware.info.name),
                }
            }
        }
        out.push(result);
    }
    out
}

#[tauri::command]
pub async fn translate_text(
    state: State<'_, AppState>,
    text: String,
    service: Option<String>,
    target: Option<String>,
) -> Result<TranslateResult, String> {
    let settings = state.settings.read().await;
    let service = service.unwrap_or_else(|| settings.service.clone());
    let target = target.unwrap_or_else(|| settings.target_lang.clone());
    drop(settings);
    let result = state
        .registry
        .read()
        .await
        .translate_one(text, Some(&service), &target)
        .await;
    Ok(apply_middlewares(state.inner(), vec![result], &target)
        .await
        .remove(0))
}

#[tauri::command]
pub async fn translate_paragraphs(
    state: State<'_, AppState>,
    paragraphs: Vec<String>,
    service: Option<String>,
    target: Option<String>,
) -> Result<Vec<TranslateResult>, String> {
    let settings = state.settings.read().await;
    let service = service.unwrap_or_else(|| settings.service.clone());
    let target = target.unwrap_or_else(|| settings.target_lang.clone());
    drop(settings);
    let results = state
        .registry
        .read()
        .await
        .translate_paragraphs(paragraphs, Some(&service), &target)
        .await;
    Ok(apply_middlewares(state.inner(), results, &target).await)
}

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> Result<Vec<PluginInfo>, String> {
    Ok(state.plugins.lock().await.clone())
}

#[tauri::command]
pub fn inspect_plugin(state: State<'_, AppState>, path: String) -> Result<PluginPreview, String> {
    PluginHost::inspect_zip(Path::new(&path), &state.data_dir.join("plugins")).map_err(err)
}

#[tauri::command]
pub async fn import_plugin(
    state: State<'_, AppState>,
    path: String,
) -> Result<PluginInfo, String> {
    let plugins_dir = state.data_dir.join("plugins");
    let info = PluginHost::install_zip(Path::new(&path), &plugins_dir).map_err(err)?;
    // Drop whatever the previous version registered so an upgrade swaps
    // cleanly, including packages that arrive disabled.
    let service_id = format!("plugin:{}", info.name);
    state.registry.write().await.unregister(&service_id);
    state.parsers.lock().await.retain(|parser| parser.info.name != info.name);
    state.plugin_panels.lock().await.retain(|panel| panel.info.name != info.name);
    state.middlewares.lock().await.retain(|middleware| middleware.info.name != info.name);
    if info.enabled {
        let loaded = PluginHost::load_plugin(
            &plugins_dir.join(&info.name),
            state.plugin_docs.clone(),
        )
        .map_err(err)?;
        if let Some(service) = loaded.service {
            state.registry.write().await.register(service);
        }
        if let Some(parser) = loaded.parser {
            state.parsers.lock().await.push(parser);
        }
        if let Some(panel) = loaded.panel {
            state.plugin_panels.lock().await.push(panel);
        }
        if let Some(middleware) = loaded.middleware {
            state.middlewares.lock().await.push(middleware);
        }
    } else {
        release_plugin_service(&state, &service_id).await?;
    }
    let mut plugins = state.plugins.lock().await;
    plugins.retain(|p| p.name != info.name);
    plugins.push(info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn plugin_panel_content(
    state: State<'_, AppState>,
    name: String,
    panel_id: String,
) -> Result<Vec<PanelSection>, String> {
    let panel = {
        let panels = state.plugin_panels.lock().await;
        panels
            .iter()
            .find(|panel| panel.info.name == name)
            .cloned()
    }
    .ok_or_else(|| format!("插件「{name}」未启用或没有动态面板"))?;
    panel.sections(&panel_id).await.map_err(err)
}

/// Runs a button/form action inside a plugin panel. The plugin answers with
/// declarative sections, so the host never renders plugin HTML.
#[tauri::command]
pub async fn plugin_panel_action(
    state: State<'_, AppState>,
    name: String,
    panel_id: String,
    action_id: String,
    values: Option<serde_json::Value>,
) -> Result<PanelActionResponse, String> {
    let panel = {
        let panels = state.plugin_panels.lock().await;
        panels
            .iter()
            .find(|panel| panel.info.name == name)
            .cloned()
    }
    .ok_or_else(|| format!("插件「{name}」未启用"))?;
    panel
        .action(&panel_id, &action_id, values)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn set_plugin_enabled(
    state: State<'_, AppState>,
    name: String,
    enabled: bool,
) -> Result<Vec<PluginInfo>, String> {
    let plugins_dir = state.data_dir.join("plugins");
    let service_id = format!("plugin:{name}");
    if enabled {
        // Instantiate and check conflicts before persisting `enabled`, so a
        // failed enable leaves both the manifest and the runtime untouched.
        let loaded = PluginHost::load_plugin(&plugins_dir.join(&name), state.plugin_docs.clone())
            .map_err(err)?;
        if let Some(parser) = &loaded.parser {
            let conflicts =
                extension_conflicts_for(state.inner(), &name, &parser.claims).await;
            if !conflicts.is_empty() {
                return Err(format!(
                    "无法启用：{}。请先停用或卸载冲突插件。",
                    conflicts.join("，")
                ));
            }
        }
        PluginHost::set_enabled(&plugins_dir, &name, true).map_err(err)?;
        if let Some(service) = loaded.service {
            state.registry.write().await.register(service);
        }
        if let Some(parser) = loaded.parser {
            let mut parsers = state.parsers.lock().await;
            parsers.retain(|existing| existing.info.name != parser.info.name);
            parsers.push(parser);
        }
        if let Some(panel) = loaded.panel {
            let mut panels = state.plugin_panels.lock().await;
            panels.retain(|existing| existing.info.name != panel.info.name);
            panels.push(panel);
        }
        if let Some(middleware) = loaded.middleware {
            let mut middlewares = state.middlewares.lock().await;
            middlewares.retain(|existing| existing.info.name != middleware.info.name);
            middlewares.push(middleware);
        }
    } else {
        PluginHost::set_enabled(&plugins_dir, &name, false).map_err(err)?;
        state.registry.write().await.unregister(&service_id);
        state.parsers.lock().await.retain(|parser| parser.info.name != name);
        state.plugin_panels.lock().await.retain(|panel| panel.info.name != name);
        state.middlewares.lock().await.retain(|middleware| middleware.info.name != name);
    }
    let snapshot = {
        let mut plugins = state.plugins.lock().await;
        if let Some(info) = plugins.iter_mut().find(|p| p.name == name) {
            info.enabled = enabled;
        }
        plugins.clone()
    };
    if !enabled {
        release_plugin_service(&state, &service_id).await?;
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn remove_plugin(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<PluginInfo>, String> {
    let service_id = format!("plugin:{name}");
    state.registry.write().await.unregister(&service_id);
    let plugins_dir = state.data_dir.join("plugins");
    PluginHost::uninstall(&plugins_dir, &name).map_err(err)?;
    state.parsers.lock().await.retain(|parser| parser.info.name != name);
    state.plugin_panels.lock().await.retain(|panel| panel.info.name != name);
    state.middlewares.lock().await.retain(|middleware| middleware.info.name != name);
    let snapshot = {
        let mut plugins = state.plugins.lock().await;
        plugins.retain(|p| p.name != name);
        plugins.clone()
    };
    release_plugin_service(&state, &service_id).await?;
    Ok(snapshot)
}

/// If the active translation service is the plugin being disabled/removed,
/// fall back to "google" so settings never point at a dangling service.
async fn release_plugin_service(
    state: &State<'_, AppState>,
    service_id: &str,
) -> Result<(), String> {
    let mut settings = state.settings.read().await.clone();
    if settings.service != service_id {
        return Ok(());
    }
    settings.service = "google".into();
    settings
        .save(&state.data_dir.join("settings.json"))
        .map_err(err)?;
    *state.settings.write().await = settings;
    Ok(())
}

#[tauri::command]
pub async fn plugin_readme(state: State<'_, AppState>, name: String) -> Result<String, String> {
    let plugins_dir = state.data_dir.join("plugins");
    PluginHost::read_readme(&plugins_dir, &name).map_err(err)
}

/// Parse a custom document through the enabled parser plugin that claimed its
/// extension. Only the file being opened is read; plugins never see a path.
#[tauri::command]
pub async fn parse_document(
    state: State<'_, AppState>,
    id: String,
) -> Result<ParsedDocument, String> {
    let (path, extension) = {
        let library = state.library.lock().await;
        let doc = library
            .get(&id)
            .ok_or_else(|| format!("document not found: {id}"))?;
        let extension = doc
            .kind
            .extension()
            .ok_or_else(|| "该文档不是插件解析格式".to_string())?
            .to_string();
        (doc.path.clone(), extension)
    };
    let by_extension = {
        let parsers = state.parsers.lock().await;
        parsers
            .iter()
            .find(|parser| parser.claims_extension(&extension))
            .cloned()
    };
    let (parser, extension) = match by_extension {
        Some(parser) => (parser, extension),
        None => magic_parser(state.inner(), Path::new(&path))
            .await
            .ok_or_else(|| {
                format!("未找到可解析 .{extension} 的插件，请安装并启用对应解析插件")
            })?,
    };
    parser.parse(Path::new(&path), &extension).await.map_err(err)
}

/// Publish the active document to plugins that declared `docRead`.
/// `None` clears it when no document is open.
#[tauri::command]
pub async fn set_plugin_document(
    state: State<'_, AppState>,
    document: Option<DocSnapshot>,
) -> Result<(), String> {
    if let Some(doc) = &document {
        if doc.blocks.len() > MAX_DOC_BLOCKS {
            return Err(format!("document has too many blocks (max {MAX_DOC_BLOCKS})"));
        }
        let bytes: usize = doc.blocks.iter().map(|block| block.text.len()).sum();
        if bytes > MAX_DOC_TEXT_BYTES {
            return Err("document text is too large for plugin access".into());
        }
    }
    *state
        .plugin_docs
        .write()
        .map_err(|_| "plugin document context is unavailable".to_string())? = document;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryData {
    pub documents: Vec<DocumentInfo>,
    pub collections: Vec<scholarust_core::Collection>,
}

#[tauri::command]
pub async fn get_library(state: State<'_, AppState>) -> Result<LibraryData, String> {
    let library = state.library.lock().await;
    Ok(LibraryData {
        documents: library.documents.clone(),
        collections: library.collections.clone(),
    })
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<scholarust_core::Collection, String> {
    let mut library = state.library.lock().await;
    let collection = library.create_collection(&name, parent_id);
    library.save().map_err(err)?;
    Ok(collection)
}

#[tauri::command]
pub async fn rename_collection(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let mut library = state.library.lock().await;
    library.rename_collection(&id, &name).map_err(err)?;
    library.save().map_err(err)
}

#[tauri::command]
pub async fn delete_collection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut library = state.library.lock().await;
    library.delete_collection(&id);
    library.save().map_err(err)
}

#[tauri::command]
pub async fn update_document_meta(
    state: State<'_, AppState>,
    id: String,
    tags: Option<Vec<String>>,
    collection_ids: Option<Vec<String>>,
) -> Result<DocumentInfo, String> {
    let mut library = state.library.lock().await;
    let doc = library
        .update_document_meta(&id, tags, collection_ids)
        .map_err(err)?;
    library.save().map_err(err)?;
    Ok(doc)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub created_at: i64,
    pub text: String,
    #[serde(default)]
    pub quote: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_note_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:032x}")
}

fn notes_file(state: &AppState, id: &str) -> Result<std::path::PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("invalid document id: {id}"));
    }
    Ok(state.data_dir.join("notes").join(format!("{id}.json")))
}

fn write_notes(state: &AppState, id: &str, notes: &[Note]) -> Result<(), String> {
    let file = notes_file(state, id)?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(err)?;
    let raw = serde_json::to_string_pretty(notes).map_err(err)?;
    std::fs::write(file, raw).map_err(err)
}

fn read_notes(state: &AppState, id: &str) -> Result<Vec<Note>, String> {
    let file = notes_file(state, id)?;
    if file.is_file() {
        let raw = std::fs::read_to_string(&file).map_err(err)?;
        return serde_json::from_str(&raw).map_err(err);
    }
    let legacy = state.data_dir.join("notes").join(format!("{id}.md"));
    let content = std::fs::read_to_string(&legacy).unwrap_or_default();
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    let created_at = std::fs::metadata(&legacy)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(now_ms);
    let notes = vec![Note {
        id: new_note_id(),
        created_at,
        text: content,
        quote: None,
    }];
    write_notes(state, id, &notes)?;
    let _ = std::fs::remove_file(&legacy);
    Ok(notes)
}

#[tauri::command]
pub async fn list_notes(state: State<'_, AppState>, id: String) -> Result<Vec<Note>, String> {
    read_notes(&state, &id)
}

#[tauri::command]
pub async fn add_note(
    state: State<'_, AppState>,
    id: String,
    text: String,
    quote: Option<String>,
) -> Result<Note, String> {
    let mut notes = read_notes(&state, &id)?;
    let note = Note {
        id: new_note_id(),
        created_at: now_ms(),
        text,
        quote,
    };
    notes.push(note.clone());
    write_notes(&state, &id, &notes)?;
    Ok(note)
}

#[tauri::command]
pub async fn delete_note(
    state: State<'_, AppState>,
    id: String,
    note_id: String,
) -> Result<(), String> {
    let mut notes = read_notes(&state, &id)?;
    notes.retain(|note| note.id != note_id);
    write_notes(&state, &id, &notes)
}

#[tauri::command]
pub async fn model_status(state: State<'_, AppState>) -> Result<crate::model::ModelStatus, String> {
    Ok(state.model.status().await)
}

#[tauri::command]
pub async fn start_model(state: State<'_, AppState>) -> Result<crate::model::ModelStatus, String> {
    state.model.ensure_started().await.map_err(err)?;
    Ok(state.model.status().await)
}

#[tauri::command]
pub async fn stop_model(state: State<'_, AppState>) -> Result<crate::model::ModelStatus, String> {
    state.model.stop().await;
    Ok(state.model.status().await)
}

#[tauri::command]
pub async fn ocr_status(state: State<'_, AppState>) -> Result<crate::model::OcrStatus, String> {
    Ok(state.model.ocr_status().await)
}

#[tauri::command]
pub async fn start_ocr(state: State<'_, AppState>) -> Result<crate::model::OcrStatus, String> {
    state.model.ensure_ocr_started().await.map_err(err)?;
    Ok(state.model.ocr_status().await)
}

#[tauri::command]
pub async fn stop_ocr(state: State<'_, AppState>) -> Result<crate::model::OcrStatus, String> {
    state.model.stop_ocr().await;
    Ok(state.model.ocr_status().await)
}

/// Which OCR model pair was auto-discovered under `models/ocr`.
#[tauri::command]
pub async fn ocr_model_info(state: State<'_, AppState>) -> Result<crate::model::OcrModelInfo, String> {
    Ok(state.model.ocr_model_info())
}

/// Runs OCR on one page image (base64 PNG) and returns the transcribed text.
#[tauri::command]
pub async fn ocr_image(state: State<'_, AppState>, png: String) -> Result<String, String> {
    // A rendered A4 page at 200 DPI stays far below this; reject anything
    // larger so a bad caller cannot exhaust memory through the IPC bridge.
    if png.len() > 48_000_000 {
        return Err("OCR 图片过大".into());
    }
    state.model.ocr_image(&png).await.map_err(err)
}

#[derive(Serialize)]
pub struct LayoutModelInfo {
    pub path: String,
    pub exists: bool,
}

#[tauri::command]
pub async fn layout_model_info(state: State<'_, AppState>) -> Result<LayoutModelInfo, String> {
    let path = state.model.layout_model_path();
    Ok(LayoutModelInfo {
        exists: path.is_file(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn read_layout_model(state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    let path = state.model.layout_model_path();
    let bytes = std::fs::read(&path).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn detect_layout(
    state: State<'_, AppState>,
    png: Vec<u8>,
) -> Result<Vec<crate::layout::Detection>, String> {
    let path = state.model.layout_model_path();
    tokio::task::spawn_blocking(move || crate::layout::detect_layout(&path, &png))
        .await
        .map_err(err)?
        .map_err(err)
}

pub fn resolve_document_image_path(base: &Path, src: &str) -> Result<std::path::PathBuf, String> {
    let base = base.canonicalize().map_err(err)?;
    let path = base.join(src).canonicalize().map_err(err)?;
    if !path.starts_with(&base) {
        return Err("image path escapes document directory".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn read_document_image(
    state: State<'_, AppState>,
    id: String,
    src: String,
) -> Result<String, String> {
    let doc_path = {
        let library = state.library.lock().await;
        let doc = library
            .get(&id)
            .ok_or_else(|| format!("document not found: {id}"))?;
        doc.path.clone()
    };
    let base = Path::new(&doc_path)
        .parent()
        .ok_or_else(|| "document has no parent directory".to_string())?;
    let path = resolve_document_image_path(base, &src)?;
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        _ => return Err("unsupported image extension".into()),
    };
    let bytes = std::fs::read(&path).map_err(err)?;
    use base64::Engine;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::resolve_document_image_path;

    #[test]
    fn resolve_document_image_path_accepts_child() {
        let root = std::env::temp_dir().join("scholarust-img-ok");
        let doc_dir = root.join("doc");
        std::fs::create_dir_all(&doc_dir).unwrap();
        std::fs::write(doc_dir.join("fig.png"), b"x").unwrap();
        let path = resolve_document_image_path(&doc_dir, "fig.png").unwrap();
        assert_eq!(path.file_name().unwrap(), "fig.png");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_document_image_path_rejects_escape() {
        let root = std::env::temp_dir().join("scholarust-img-escape");
        let doc_dir = root.join("doc");
        std::fs::create_dir_all(&doc_dir).unwrap();
        std::fs::write(root.join("secret.png"), b"x").unwrap();
        let err = resolve_document_image_path(&doc_dir, "../secret.png").unwrap_err();
        assert!(err.contains("escapes"));
        let _ = std::fs::remove_dir_all(&root);
    }
}