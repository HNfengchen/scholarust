mod commands;
mod model;
mod state;

use model::{HyMt2Service, ModelManager};
use scholarust_core::Library;
use scholarust_plugin_host::PluginHost;
use scholarust_translate::services::{google::GoogleService, mymemory::MyMemoryService, openai::OpenAIService};
use scholarust_translate::ServiceRegistry;
use state::{AppState, Settings};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::{Mutex, RwLock};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let library = Library::load(data_dir.join("library.json"));
            let settings = Settings::load(&data_dir.join("settings.json"));
            let openai_config = Arc::new(RwLock::new(settings.to_openai_config()));

            let models_dir = model::resolve_models_dir(&data_dir);
            let model_manager = Arc::new(ModelManager::new(models_dir));

            let mut registry = ServiceRegistry::new();
            registry.register(Arc::new(GoogleService::default()));
            registry.register(Arc::new(MyMemoryService::default()));
            registry.register(Arc::new(OpenAIService::new(openai_config.clone())));
            registry.register(Arc::new(HyMt2Service::new(model_manager.clone())));

            let plugin_host = PluginHost::load_dir(&data_dir.join("plugins"));
            for service in plugin_host.services {
                registry.register(service);
            }

            app.manage(AppState {
                library: Mutex::new(library),
                registry: RwLock::new(registry),
                settings: RwLock::new(settings),
                openai_config,
                plugins: Mutex::new(plugin_host.plugins),
                data_dir,
                model: model_manager,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_documents,
            commands::open_document,
            commands::remove_document,
            commands::get_content,
            commands::list_services,
            commands::get_settings,
            commands::set_settings,
            commands::translate_text,
            commands::translate_paragraphs,
            commands::list_plugins,
            commands::import_plugin,
            commands::set_plugin_enabled,
            commands::remove_plugin,
            commands::get_library,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
            commands::update_document_meta,
            commands::get_notes,
            commands::save_notes,
            commands::model_status,
            commands::start_model,
            commands::stop_model,
        ])
        .build(tauri::generate_context!())
        .expect("error while building scholarust");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                let manager = state.model.clone();
                tauri::async_runtime::block_on(manager.stop());
            }
        }
    });
}