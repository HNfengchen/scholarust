import type { ComponentType, MutableRefObject, RefObject } from "react";
import type { StructureExtractor } from "../structure";
import type { OutlineEntry } from "../outline";
import type {
  DocumentContent,
  DocumentInfo,
  ParagraphExtractor,
  PluginInfo,
  SelectionTranslation,
  ServiceInfo,
  Settings,
} from "../types";

export interface PanelContext {
  document: DocumentInfo | null;
  content: DocumentContent | null;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  outlineRef: MutableRefObject<(() => Promise<OutlineEntry[]>) | null>;
  readerHostRef: RefObject<HTMLDivElement>;
  selection: SelectionTranslation | null;
  services: ServiceInfo[];
  settings: Settings | null;
  plugins: PluginInfo[];
  onUpdateSettings: (changes: Partial<Settings>) => void;
  onSaveSettings: (settings: Settings) => Promise<boolean>;
  onTranslateSelection: (text: string) => void;
  onRefreshPlugins: () => Promise<void>;
  onShowOriginal: () => void;
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
