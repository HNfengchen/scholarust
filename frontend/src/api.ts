import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  Collection,
  DocumentContent,
  DocumentInfo,
  LayoutModelInfo,
  LibraryData,
  ModelStatus,
  PluginInfo,
  ServiceInfo,
  Settings,
  TranslationResult,
} from "./types";

export { convertFileSrc };

export function getLibrary(): Promise<LibraryData> {
  return invoke<LibraryData>("get_library");
}

export function createCollection(name: string, parentId: string | null): Promise<Collection> {
  return invoke<Collection>("create_collection", { name, parentId });
}

export function renameCollection(id: string, name: string): Promise<void> {
  return invoke<void>("rename_collection", { id, name });
}

export function deleteCollection(id: string): Promise<void> {
  return invoke<void>("delete_collection", { id });
}

export function updateDocumentMeta(
  id: string,
  tags: string[],
  collectionIds: string[],
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("update_document_meta", { id, tags, collectionIds });
}

export function getNotes(id: string): Promise<string> {
  return invoke<string>("get_notes", { id });
}

export function saveNotes(id: string, content: string): Promise<void> {
  return invoke<void>("save_notes", { id, content });
}

export function modelStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>("model_status");
}

export function startModel(): Promise<ModelStatus> {
  return invoke<ModelStatus>("start_model");
}

export function stopModel(): Promise<void> {
  return invoke<void>("stop_model");
}

export function layoutModelInfo(): Promise<LayoutModelInfo> {
  return invoke<LayoutModelInfo>("layout_model_info");
}

export function readDocumentImage(id: string, src: string): Promise<string> {
  return invoke<string>("read_document_image", { id, src });
}

export function openDocument(path: string): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("open_document", { path });
}

export function removeDocument(id: string): Promise<void> {
  return invoke<void>("remove_document", { id });
}

export function getContent(id: string): Promise<DocumentContent> {
  return invoke<DocumentContent>("get_content", { id });
}

export function listServices(): Promise<ServiceInfo[]> {
  return invoke<ServiceInfo[]>("list_services");
}

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function setSettings(settings: Settings): Promise<void> {
  return invoke<void>("set_settings", { settings });
}

export function translateText(
  text: string,
  service?: string,
  target?: string,
): Promise<TranslationResult> {
  const args: Record<string, unknown> = { text };
  if (service) args.service = service;
  if (target) args.target = target;
  return invoke<TranslationResult>("translate_text", args);
}

export function translateParagraphs(
  paragraphs: string[],
  service?: string,
  target?: string,
): Promise<TranslationResult[]> {
  const args: Record<string, unknown> = { paragraphs };
  if (service) args.service = service;
  if (target) args.target = target;
  return invoke<TranslationResult[]>("translate_paragraphs", args);
}

export function listPlugins(): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("list_plugins");
}

export function importPlugin(path: string): Promise<PluginInfo> {
  return invoke<PluginInfo>("import_plugin", { path });
}

export function setPluginEnabled(name: string, enabled: boolean): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("set_plugin_enabled", { name, enabled });
}

export function removePlugin(name: string): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("remove_plugin", { name });
}
