import type { ComponentType, MutableRefObject, RefObject } from "react";
import type { DocumentStructure, StructureExtractor } from "../structure";
import type { OutlineExtractor } from "../outline";
import type {
  DocumentContent,
  DocumentInfo,
  OcrCapture,
  ParagraphExtractor,
  PluginInfo,
  SelectionTranslation,
  ServiceInfo,
  Settings,
  ViewMode,
} from "../types";

export interface PanelContext {
  document: DocumentInfo | null;
  content: DocumentContent | null;
  mode: ViewMode;
  structure: DocumentStructure | null;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  outlineRef: MutableRefObject<OutlineExtractor | null>;
  readerHostRef: RefObject<HTMLDivElement>;
  readingHostRef: RefObject<HTMLDivElement>;
  selection: SelectionTranslation | null;
  selectionText: string | null;
  ocr: OcrCapture | null;
  services: ServiceInfo[];
  settings: Settings | null;
  plugins: PluginInfo[];
  onUpdateSettings: (changes: Partial<Settings>) => void;
  onSaveSettings: (settings: Settings) => Promise<boolean>;
  onTranslateSelection: (text: string) => void;
  onRefreshPlugins: () => Promise<void>;
  onShowOriginal: () => void;
  onJumpToBlock: (blockId: number) => void;
  onNotify: (message: string) => void;
}

export interface PanelDescriptor {
  id: string;
  title: string;
  icon: string;
  render: ComponentType<PanelContext>;
}

const panels: PanelDescriptor[] = [];

export function registerPanel(descriptor: PanelDescriptor): void {
  if (!panels.some((panel) => panel.id === descriptor.id)) {
    panels.push(descriptor);
  }
}

export function getPanels(): PanelDescriptor[] {
  return panels;
}
