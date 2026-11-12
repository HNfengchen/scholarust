export type BuiltinDocumentKind = "pdf" | "epub" | "docx" | "markdown" | "text";
/** `plugin:<extension>` is a format handled by an installed parser plugin. */
export type DocumentKind = BuiltinDocumentKind | `plugin:${string}`;

export interface DocumentInfo {
  id: string;
  path: string;
  title: string;
  kind: DocumentKind;
  tags: string[];
  collectionIds: string[];
}

export interface Collection {
  id: string;
  name: string;
  parentId: string | null;
}

export interface LibraryData {
  documents: DocumentInfo[];
  collections: Collection[];
}

export interface ModelStatus {
  running: boolean;
  detail: string;
}

export interface LayoutModelInfo {
  path: string;
  exists: boolean;
}

export interface ServiceInfo {
  id: string;
  name: string;
}

export interface Settings {
  targetLang: string;
  service: string;
  openaiEndpoint: string;
  openaiModel: string;
  openaiKey: string;
}

export type PluginKind = "translate" | "panel" | "parser" | "other";

export interface PluginPermissions {
  docRead: boolean;
  storage: boolean;
  http: string[];
}

export interface PluginPanelKeyValue {
  key: string;
  value: string;
}

export type PluginPanelSection =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "keyValue"; items: PluginPanelKeyValue[] };

export type PluginPanelIcon = "info" | "list" | "table" | "book" | "notes" | "sparkle";

export interface PluginPanel {
  id: string;
  title: string;
  description?: string;
  icon?: PluginPanelIcon | string;
  /** Live content is requested from the plugin's `panel` export. */
  dynamic?: boolean;
  sections: PluginPanelSection[];
}

export interface PluginParserClaim {
  id: string;
  label?: string;
  extensions: string[];
  /** Hex signatures matched at offset 0 for extensionless files. */
  magic?: string[];
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  apiVersion: number;
  kind: PluginKind;
  permissions: PluginPermissions;
  contributes: { panels: PluginPanel[]; parsers: PluginParserClaim[] };
  /** Set when the runtime skipped a capability due to an extension conflict. */
  conflict?: string;
}

export interface PluginExtensionConflict {
  extension: string;
  plugin: string;
}

export type PluginVersionChange = "new" | "upgrade" | "downgrade" | "same" | "different";

/** What installing a package would change, shown before consent. */
export interface PluginPreview {
  info: PluginInfo;
  digest: string;
  installed: PluginInfo | null;
  versionChange: PluginVersionChange;
  conflicts: PluginExtensionConflict[];
}

export interface PluginDocBlock {
  id: number;
  kind: string;
  text: string;
}

export interface PluginDocSnapshot {
  title: string;
  blocks: PluginDocBlock[];
}

export interface TranslationResult {
  raw: string;
  result: string;
  error?: string;
}

export interface DocumentContent {
  kind: DocumentKind;
  html: string | null;
  raw: string | null;
  path: string;
}

export type ViewMode = "original" | "reading";

export interface Paragraph {
  text: string;
  page: number | null;
}

export type ParagraphExtractor = () => Promise<Paragraph[]>;

export interface BlockTranslation {
  status: "loading" | "done" | "error";
  result?: TranslationResult;
  message?: string;
}

export interface SelectionTranslation {
  source: string;
  status: "loading" | "done" | "error";
  result?: TranslationResult;
  serviceName?: string;
  message?: string;
}

export interface Note {
  id: string;
  createdAt: number;
  text: string;
  quote?: string | null;
}

export const TARGET_LANGUAGES: { value: string; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "ru", label: "Русский" },
  { value: "es", label: "Español" },
];

export const KIND_LABELS: Record<BuiltinDocumentKind, string> = {
  pdf: "PDF",
  epub: "EPUB",
  docx: "DOCX",
  markdown: "MD",
  text: "TXT",
};

export function pluginExtension(kind: DocumentKind): string | null {
  return kind.startsWith("plugin:") ? kind.slice("plugin:".length) : null;
}

export function kindLabel(kind: DocumentKind): string {
  const extension = pluginExtension(kind);
  return extension ? extension.toUpperCase() : KIND_LABELS[kind as BuiltinDocumentKind];
}

export function kindClass(kind: DocumentKind): string {
  return pluginExtension(kind) ? "kind-badge kind-plugin" : `kind-badge kind-${kind}`;
}

export const KIND_FILTERS: { kind: BuiltinDocumentKind; label: string }[] = [
  { kind: "pdf", label: "PDF" },
  { kind: "epub", label: "EPUB" },
  { kind: "docx", label: "Word" },
  { kind: "markdown", label: "Markdown" },
  { kind: "text", label: "文本" },
];

export function serviceHint(serviceId: string | undefined): string {
  if (!serviceId) return "请选择翻译服务";
  if (serviceId === "google" || serviceId === "mymemory") {
    return "公共免费接口，无需填写 URL 或密钥，高峰时段可能限流";
  }
  if (serviceId === "local-llm") return "本地离线模型，无需联网与密钥，首次翻译时自动启动";
  if (serviceId === "openai") return "需在「设置」面板填写 Endpoint、Model 与 API Key";
  if (serviceId.startsWith("plugin:")) return "由已安装的插件提供，可在「扩展」面板管理";
  return "自定义翻译服务";
}
