import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  PluginDocSnapshot,
  Collection,
  DocumentContent,
  DocumentInfo,
  LayoutModelInfo,
  LibraryData,
  ModelStatus,
  Note,
  OcrModelInfo,
  PluginActionValues,
  PluginInfo,
  PluginPanelActionResponse,
  PluginPanelSection,
  PluginPreview,
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

export function listNotes(id: string): Promise<Note[]> {
  return invoke<Note[]>("list_notes", { id });
}

export function addNote(id: string, text: string, quote?: string): Promise<Note> {
  return invoke<Note>("add_note", { id, text, quote: quote ?? null });
}

export function deleteNote(id: string, noteId: string): Promise<void> {
  return invoke<void>("delete_note", { id, noteId });
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

export function ocrStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>("ocr_status");
}

export function startOcr(): Promise<ModelStatus> {
  return invoke<ModelStatus>("start_ocr");
}

export function stopOcr(): Promise<ModelStatus> {
  return invoke<ModelStatus>("stop_ocr");
}

export function ocrModelInfo(): Promise<OcrModelInfo> {
  return invoke<OcrModelInfo>("ocr_model_info");
}

/** Sends one page image (base64 PNG) to the local OCR model. */
export function ocrImage(png: string): Promise<string> {
  return invoke<string>("ocr_image", { png });
}

export function layoutModelInfo(): Promise<LayoutModelInfo> {
  return invoke<LayoutModelInfo>("layout_model_info");
}

export function readLayoutModel(): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_layout_model");
}

export interface LayoutDetection {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  classId: number;
}

export function detectLayout(png: Uint8Array): Promise<LayoutDetection[]> {
  return invoke<LayoutDetection[]>("detect_layout", { png: Array.from(png) });
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

/** Reads a package's manifest, digest and conflicts without installing it. */
export function inspectPlugin(path: string): Promise<PluginPreview> {
  return invoke<PluginPreview>("inspect_plugin", { path });
}

export function pluginPanelContent(
  name: string,
  panelId: string,
): Promise<PluginPanelSection[]> {
  return invoke<PluginPanelSection[]>("plugin_panel_content", { name, panelId });
}

/** Runs a declarative button/form action and returns updated sections. */
export function pluginPanelAction(
  name: string,
  panelId: string,
  actionId: string,
  values?: PluginActionValues,
): Promise<PluginPanelActionResponse> {
  return invoke<PluginPanelActionResponse>("plugin_panel_action", {
    name,
    panelId,
    actionId,
    values: values ?? null,
  });
}

export function setPluginEnabled(name: string, enabled: boolean): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("set_plugin_enabled", { name, enabled });
}

export function removePlugin(name: string): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("remove_plugin", { name });
}

export function pluginReadme(name: string): Promise<string> {
  return invoke<string>("plugin_readme", { name });
}

/** Publish the active document to plugins that declared docRead. */
export function setPluginDocument(document: PluginDocSnapshot | null): Promise<void> {
  return invoke<void>("set_plugin_document", { document });
}

export interface ParsedBlockPayload {
  id: number;
  kind: string;
  text: string;
  level: number;
  image?: string;
}

export interface ParsedDocumentPayload {
  title: string | null;
  notice: string | null;
  blocks: ParsedBlockPayload[];
}

/** Parse a custom format through the enabled parser plugin that claimed it. */
export function parseDocument(id: string): Promise<ParsedDocumentPayload> {
  return invoke<ParsedDocumentPayload>("parse_document", { id });
}
