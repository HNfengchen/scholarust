use crate::state::{AppState, Settings};
use base64::Engine;
use scholarust_core::{markdown, DocumentInfo};
use scholarust_plugin_host::{PluginHost, PluginInfo};
use scholarust_translate::{ServiceInfo, TranslateResult};
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
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
    let doc = DocumentInfo::from_path(Path::new(&path)).map_err(err)?;
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
    let html = match doc.kind {
        scholarust_core::DocumentKind::Markdown => {
            let source = std::fs::read_to_string(&doc.path).map_err(err)?;
            Some(markdown::render_markdown(&source))
        }
        scholarust_core::DocumentKind::Text => {
            let source = std::fs::read_to_string(&doc.path).map_err(err)?;
            Some(markdown::render_text(&source))
        }
        _ => None,
    };
    Ok(ContentPayload {
        kind: doc.kind,
        html,
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
    Ok(state
        .registry
        .read()
        .await
        .translate_one(text, Some(&service), &target)
        .await)
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
    Ok(state
        .registry
        .read()
        .await
        .translate_paragraphs(paragraphs, Some(&service), &target)
        .await)
}

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> Result<Vec<PluginInfo>, String> {
    Ok(state.plugins.lock().await.clone())
}

#[tauri::command]
pub async fn import_plugin(
    state: State<'_, AppState>,
    path: String,
) -> Result<PluginInfo, String> {
    let plugins_dir = state.data_dir.join("plugins");
    let info = PluginHost::install_zip(Path::new(&path), &plugins_dir).map_err(err)?;
    if info.enabled {
        let (_, service) =
            PluginHost::load_service(&plugins_dir.join(&info.name)).map_err(err)?;
        state.registry.write().await.register(service);
    }
    let mut plugins = state.plugins.lock().await;
    plugins.retain(|p| p.name != info.name);
    plugins.push(info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn set_plugin_enabled(
    state: State<'_, AppState>,
    name: String,
    enabled: bool,
) -> Result<Vec<PluginInfo>, String> {
    let plugins_dir = state.data_dir.join("plugins");
    PluginHost::set_enabled(&plugins_dir, &name, enabled).map_err(err)?;
    let service_id = format!("plugin:{name}");
    if enabled {
        let (_, service) = PluginHost::load_service(&plugins_dir.join(&name)).map_err(err)?;
        state.registry.write().await.register(service);
    } else {
        state.registry.write().await.unregister(&service_id);
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

#[tauri::command]
pub async fn get_notes(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let file = state.data_dir.join("notes").join(format!("{id}.md"));
    Ok(std::fs::read_to_string(file).unwrap_or_default())
}

#[tauri::command]
pub async fn save_notes(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), String> {
    let dir = state.data_dir.join("notes");
    std::fs::create_dir_all(&dir).map_err(err)?;
    std::fs::write(dir.join(format!("{id}.md")), content).map_err(err)
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

#[derive(Serialize)]
pub struct LayoutModelInfo {
    pub path: String,
    pub exists: bool,
}

#[tauri::command]
pub async fn layout_model_info(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LayoutModelInfo, String> {
    let path = state.model.layout_model_path();
    let exists = path.is_file();
    if exists {
        app.asset_protocol_scope().allow_file(&path).map_err(err)?;
    }
    Ok(LayoutModelInfo {
        path: path.to_string_lossy().into_owned(),
        exists,
    })
}

pub fn resolve_document_image_path(base: &Path, src: &str) -> Result<std::path::PathBuf, String> {
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    let path = base.join(src).canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&base) {
        return Err("image path escapes document directory".into());
    }
    Ok(path)
}

fn image_mime(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
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
        .ok_or_else(|| format!("document has no parent directory: {doc_path}"))?;
    let path = resolve_document_image_path(base, &src)?;
    let bytes = std::fs::read(&path).map_err(err)?;
    let mime = path
        .extension()
        .and_then(|e| e.to_str())
        .map(image_mime)
        .unwrap_or("application/octet-stream");
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
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