export type DocumentKind = "pdf" | "epub" | "docx" | "markdown" | "text";

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

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
}

export interface TranslationResult {
  raw: string;
  result: string;
  error?: string;
}

export interface DocumentContent {
  kind: DocumentKind;
  html: string | null;
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

export const TARGET_LANGUAGES: { value: string; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "ru", label: "Русский" },
  { value: "es", label: "Español" },
];

export const KIND_LABELS: Record<DocumentKind, string> = {
  pdf: "PDF",
  epub: "EPUB",
  docx: "DOCX",
  markdown: "MD",
  text: "TXT",
};

export const KIND_FILTERS: { kind: DocumentKind; label: string }[] = [
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
  if (serviceId === "hy-mt2") return "本地离线模型，无需联网与密钥，首次翻译时自动启动";
  if (serviceId === "openai") return "需在「设置」面板填写 Endpoint、Model 与 API Key";
  if (serviceId.startsWith("plugin:")) return "由已安装的插件提供，可在「扩展」面板管理";
  return "自定义翻译服务";
}
