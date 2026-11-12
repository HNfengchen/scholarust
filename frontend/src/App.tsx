import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import Reader from "./components/Reader";
import RightPane, { MIN_PANEL_WIDTH } from "./components/RightPane";
import ReadingView from "./components/ReadingView";
import "./panels";
import { scrollToBlock } from "./panels/readerDom";
import type { PanelContext } from "./panels/registry";
import * as api from "./api";
import { CONTENT_KINDS } from "./structure";
import type {
  DocumentStructure,
  ReadingStructureExtractor,
  StructuredBlock,
  StructureExtractor,
} from "./structure";
import type { OutlineExtractor } from "./outline";
import { normalizeOcrText } from "./ocrText";
import { computeCrop, ocrSourceOf } from "./ocrSelection";
import type {
  BlockTranslation,
  Collection,
  DocumentContent,
  DocumentInfo,
  OcrCapture,
  ParagraphExtractor,
  PluginFormatFilter,
  PluginInfo,
  SelectionTranslation,
  ServiceInfo,
  Settings,
  ViewMode,
} from "./types";

const RECENT_KEY = "scholarust.recent-docs";

interface ReadingCache {
  structure: DocumentStructure;
  translations: Record<number, BlockTranslation>;
}

function loadRecentIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function loadPaneWidth(): number {
  try {
    const raw = window.localStorage.getItem("scholarust.paneWidth");
    const value = raw == null ? NaN : Number(raw);
    return Number.isFinite(value) && value >= MIN_PANEL_WIDTH ? value : 320;
  } catch {
    return 320;
  }
}

function loadZoom(): number {
  try {
    const raw = window.localStorage.getItem("scholarust.reader.zoom");
    const value = raw == null ? NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(3, Math.max(0.5, value)) : 1;
  } catch {
    return 1;
  }
}

export default function App() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocumentInfo | null>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [mode, setMode] = useState<ViewMode>("original");
  const [structure, setStructure] = useState<DocumentStructure | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [blockTranslations, setBlockTranslations] = useState<Record<number, BlockTranslation>>({});
  const [ocr, setOcr] = useState<OcrCapture | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [selection, setSelection] = useState<SelectionTranslation | null>(null);
  const [selectionText, setSelectionText] = useState<string | null>(null);
  const [activePanelId, setActivePanelId] = useState<string | null>("translate");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentIds);
  const [paneWidth, setPaneWidth] = useState(loadPaneWidth);
  const [zoom, setZoom] = useState(loadZoom);

  const extractorRef = useRef<ParagraphExtractor | null>(null);
  const structureRef = useRef<StructureExtractor | null>(null);
  const readingStructureRef = useRef<ReadingStructureExtractor | null>(null);
  const outlineRef = useRef<OutlineExtractor | null>(null);
  const readerHostRef = useRef<HTMLDivElement>(null);
  const readingHostRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLElement>(null);
  const readingCache = useRef(new Map<string, ReadingCache>());
  const activeDocIdRef = useRef<string | null>(null);
  const batchSeq = useRef(0);
  const selectionSeq = useRef(0);
  const readingAbortRef = useRef<AbortController | null>(null);
  const pendingBlockRef = useRef<number | null>(null);

  const showError = useCallback((message: string) => setError(message), []);

  const persistRecent = useCallback((ids: string[]) => {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const markRecent = useCallback(
    (id: string) => {
      setRecentIds((prev) => {
        const next = [id, ...prev.filter((existing) => existing !== id)].slice(0, 30);
        persistRecent(next);
        return next;
      });
    },
    [persistRecent],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        api.getLibrary(),
        api.listServices(),
        api.getSettings(),
        api.listPlugins(),
      ]);
      if (cancelled) return;
      const [library, svc, cfg, plugs] = results;
      if (library.status === "fulfilled") {
        setDocuments(library.value.documents);
        setCollections(library.value.collections);
      }
      if (svc.status === "fulfilled") setServices(svc.value);
      if (cfg.status === "fulfilled") setSettings(cfg.value);
      if (plugs.status === "fulfilled") setPlugins(plugs.value);
      if (results.some((result) => result.status === "rejected")) {
        setError("后端服务未就绪或加载失败，部分功能暂不可用");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const docReadEnabled = plugins.some(
    (plugin) => plugin.enabled && plugin.permissions.docRead,
  );
  useEffect(() => {
    if (!docReadEnabled || !activeDoc || !structure) {
      void api.setPluginDocument(null).catch(() => {});
      return;
    }
    void api
      .setPluginDocument({
        title: activeDoc.title,
        blocks: structure.blocks
          .filter((block) => block.text.trim())
          .map(({ id, kind, text }) => ({ id, kind, text })),
      })
      .catch(() => {});
  }, [activeDoc, structure, docReadEnabled]);

  useEffect(() => {
    activeDocIdRef.current = activeDoc?.id ?? null;
    batchSeq.current++;
    readingAbortRef.current?.abort();
    readingAbortRef.current = null;
    setBatchRunning(false);
    if (!activeDoc) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContent(null);
    setMode("original");
    // OCR selection belongs to the document it was started on; a new document
    // starts a fresh session instead of leaving a stale crosshair state.
    setActivePanelId((prev) => (prev === "ocr" ? null : prev));
    setStructure(null);
    pendingBlockRef.current = null;
    setOcr(null);
    setExtractProgress(null);
    setStructureLoading(false);
    setBlockTranslations({});
    setSelectionText(null);
    setContentLoading(true);
    api
      .getContent(activeDoc.id)
      .then((loaded) => {
        if (!cancelled) setContent(loaded);
      })
      .catch((err) => {
        if (!cancelled) showError(`文档加载失败：${String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDoc, showError]);

  const handleSelectDoc = useCallback(
    (doc: DocumentInfo) => {
      setActiveDoc(doc);
      markRecent(doc.id);
    },
    [markRecent],
  );

  const parserExtensions = useMemo(
    () =>
      Array.from(
        new Set(
          plugins
            .filter((plugin) => plugin.enabled)
            .flatMap((plugin) =>
              plugin.contributes.parsers.flatMap((parser) => parser.extensions),
            ),
        ),
      ),
    [plugins],
  );

  // Format categories contributed by enabled parser plugins (e.g. the image
// plugin adds an "图片" entry to the sidebar's format filter).
  const pluginFormats = useMemo<PluginFormatFilter[]>(
    () =>
      plugins
        .filter((plugin) => plugin.enabled)
        .flatMap((plugin) =>
          plugin.contributes.parsers
            .filter((parser) => parser.extensions.length > 0)
            .map((parser) => ({
              key: `plugin-format:${plugin.name}:${parser.id}`,
              label: parser.label?.trim() || parser.id,
              extensions: parser.extensions.map((extension) => extension.toLowerCase()),
            })),
        ),
    [plugins],
  );

  const magicSniffing = useMemo(
    () =>
      plugins.some(
        (plugin) =>
          plugin.enabled &&
          plugin.contributes.parsers.some((parser) => (parser.magic?.length ?? 0) > 0),
      ),
    [plugins],
  );

  const handleOpenFiles = useCallback(async () => {
    setOpening(true);
    try {
      const picked = await open({
        multiple: true,
        filters: [
          {
            name: "文档",
            extensions: ["pdf", "epub", "docx", "md", "markdown", "txt", ...parserExtensions],
          },
          ...(magicSniffing ? [{ name: "所有文件", extensions: ["*"] }] : []),
        ],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      let last: DocumentInfo | null = null;
      for (const path of paths) {
        try {
          const doc = await api.openDocument(path);
          last = doc;
          setDocuments((prev) =>
            prev.some((existing) => existing.id === doc.id) ? prev : [...prev, doc],
          );
          markRecent(doc.id);
        } catch (err) {
          showError(`打开文件失败：${String(err)}`);
        }
      }
      if (last) setActiveDoc(last);
    } catch (err) {
      showError(`打开文件对话框失败：${String(err)}`);
    } finally {
      setOpening(false);
    }
  }, [magicSniffing, markRecent, parserExtensions, showError]);

  const handleRemove = useCallback(
    async (doc: DocumentInfo) => {
      if (!window.confirm(`确定从文库移除《${doc.title}》吗？`)) return;
      try {
        await api.removeDocument(doc.id);
        setDocuments((prev) => prev.filter((existing) => existing.id !== doc.id));
        setRecentIds((prev) => {
          const next = prev.filter((id) => id !== doc.id);
          persistRecent(next);
          return next;
        });
        readingCache.current.delete(doc.id);
        setActiveDoc((prev) => (prev && prev.id === doc.id ? null : prev));
      } catch (err) {
        showError(`移除文档失败：${String(err)}`);
      }
    },
    [persistRecent, showError],
  );

  const handleCreateCollection = useCallback(
    async (name: string, parentId: string | null) => {
      try {
        const created = await api.createCollection(name, parentId);
        setCollections((prev) => [...prev, created]);
      } catch (err) {
        showError(`新建收藏夹失败：${String(err)}`);
      }
    },
    [showError],
  );

  const handleRenameCollection = useCallback(
    async (id: string, name: string) => {
      try {
        await api.renameCollection(id, name);
        setCollections((prev) =>
          prev.map((collection) => (collection.id === id ? { ...collection, name } : collection)),
        );
      } catch (err) {
        showError(`重命名收藏夹失败：${String(err)}`);
      }
    },
    [showError],
  );

  const handleDeleteCollection = useCallback(
    async (id: string) => {
      try {
        await api.deleteCollection(id);
        setCollections((prev) => prev.filter((collection) => collection.id !== id));
        setDocuments((prev) =>
          prev.map((doc) =>
            (doc.collectionIds ?? []).includes(id)
              ? { ...doc, collectionIds: doc.collectionIds.filter((cid) => cid !== id) }
              : doc,
          ),
        );
      } catch (err) {
        showError(`删除收藏夹失败：${String(err)}`);
      }
    },
    [showError],
  );

  const handleUpdateDocMeta = useCallback(
    async (id: string, tags: string[], collectionIds: string[]) => {
      try {
        const updated = await api.updateDocumentMeta(id, tags, collectionIds);
        setDocuments((prev) => prev.map((doc) => (doc.id === id ? updated : doc)));
        setActiveDoc((prev) => (prev && prev.id === id ? updated : prev));
      } catch (err) {
        showError(`更新文档信息失败：${String(err)}`);
      }
    },
    [showError],
  );

  const updateSettings = useCallback(
    (changes: Partial<Settings>) => {
      if (!settings) return;
      const next = { ...settings, ...changes };
      setSettings(next);
      api.setSettings(next).catch((err) => showError(`保存设置失败：${String(err)}`));
    },
    [settings, showError],
  );

  const handleSaveSettings = useCallback(
    async (next: Settings): Promise<boolean> => {
      try {
        await api.setSettings(next);
        setSettings(next);
        return true;
      } catch (err) {
        showError(`保存设置失败：${String(err)}`);
        return false;
      }
    },
    [showError],
  );

  const cancelReading = useCallback(() => {
    readingAbortRef.current?.abort();
    readingAbortRef.current = null;
    setStructureLoading(false);
    setExtractProgress(null);
    setMode("original");
  }, []);

  const handleZoomChange = useCallback((next: number) => {
    const clamped = Math.min(3, Math.max(0.5, Math.round(next * 10) / 10));
    setZoom(clamped);
    try {
      window.localStorage.setItem("scholarust.reader.zoom", String(clamped));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const handlePanelWidthChange = useCallback((width: number) => {
    setPaneWidth(width);
    try {
      window.localStorage.setItem("scholarust.paneWidth", String(Math.round(width)));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const startReading = useCallback(async () => {
    const doc = activeDoc;
    if (!doc) return;
    readingAbortRef.current?.abort();
    readingAbortRef.current = null;
    const cached = readingCache.current.get(doc.id);
    if (cached) {
      setStructure(cached.structure);
      setBlockTranslations(cached.translations);
      setExtractProgress(null);
      setStructureLoading(false);
      setMode("reading");
      return;
    }
    const extract = readingStructureRef.current;
    const fallback = structureRef.current;
    if (!extract && !fallback) {
      showError("阅读器尚未就绪，无法解析文档结构");
      return;
    }
    const controller = new AbortController();
    readingAbortRef.current = controller;
    setStructureLoading(true);
    setStructure(null);
    setExtractProgress(null);
    setBlockTranslations({});
    setMode("reading");
    try {
      const parsed = await (extract
        ? extract((done, total) => {
            if (activeDocIdRef.current === doc.id) setExtractProgress({ done, total });
          }, controller.signal)
        : fallback!());
      if (controller.signal.aborted || activeDocIdRef.current !== doc.id) return;
      if (parsed.blocks.length === 0 && !parsed.notice) throw new Error("未解析到可阅读的内容块");
      readingCache.current.set(doc.id, { structure: parsed, translations: {} });
      setStructure(parsed);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (activeDocIdRef.current === doc.id) {
        showError(`阅读模式解析失败：${String(err)}`);
        setMode("original");
      }
    } finally {
      if (readingAbortRef.current === controller) {
        readingAbortRef.current = null;
        if (activeDocIdRef.current === doc.id) {
          setStructureLoading(false);
          setExtractProgress(null);
        }
      }
    }
  }, [activeDoc, showError]);

  /** Runs OCR on one selected page region and shows it in the right pane. */
  const handleOcrSelection = useCallback(
    async (png: string) => {
      setActivePanelId("ocr");
      const image = `data:image/png;base64,${png}`;
      setOcr({ status: "loading", image });
      try {
        const text = await api.ocrImage(png);
        setOcr({ status: "done", image, text: normalizeOcrText(text) });
      } catch (err) {
        setOcr({ status: "error", image, message: String(err) });
      }
    },
    [],
  );

  /** Drag-selects a region of a page canvas or image while the OCR panel is open. */
  const handleReaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (mode !== "ocr" || event.button !== 0) return;
      const source = ocrSourceOf(event.target as Element);
      if (!source) return;
      const rect = source.element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      event.preventDefault();

      const startX = event.clientX;
      const startY = event.clientY;
      const marquee = document.createElement("div");
      marquee.className = "ocr-marquee";
      document.body.appendChild(marquee);
      const clampTo = (value: number, min: number, max: number) =>
        Math.min(max, Math.max(min, value));

      const draw = (clientX: number, clientY: number) => {
        const left = clampTo(Math.min(startX, clientX), rect.left, rect.right);
        const top = clampTo(Math.min(startY, clientY), rect.top, rect.bottom);
        const right = clampTo(Math.max(startX, clientX), rect.left, rect.right);
        const bottom = clampTo(Math.max(startY, clientY), rect.top, rect.bottom);
        marquee.style.left = `${left}px`;
        marquee.style.top = `${top}px`;
        marquee.style.width = `${right - left}px`;
        marquee.style.height = `${bottom - top}px`;
        return {
          left: left - rect.left,
          top: top - rect.top,
          width: right - left,
          height: bottom - top,
        };
      };

      const onMove = (moveEvent: PointerEvent) => {
        draw(moveEvent.clientX, moveEvent.clientY);
      };
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const box = draw(upEvent.clientX, upEvent.clientY);
        if (box.width < 8 || box.height < 8) {
          marquee.remove();
          return;
        }
        const crop = computeCrop(source.width, source.height, rect.width, rect.height, box);
        const canvas = document.createElement("canvas");
        canvas.width = crop.outW;
        canvas.height = crop.outH;
        const context = canvas.getContext("2d");
        if (!context) {
          marquee.remove();
          return;
        }
        context.drawImage(
          source.element,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          0,
          0,
          crop.outW,
          crop.outH,
        );
        const dataUrl = canvas.toDataURL("image/png");
        void handleOcrSelection(dataUrl.slice(dataUrl.indexOf(",") + 1));
        marquee.classList.add("ocr-marquee-done");
        window.setTimeout(() => marquee.remove(), 1200);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [mode, handleOcrSelection],
  );

  const applyTranslation = useCallback(
    (docId: string, blockId: number, translation: BlockTranslation) => {
      const cached = readingCache.current.get(docId);
      if (!cached) return;
      cached.translations = { ...cached.translations, [blockId]: translation };
      if (activeDocIdRef.current === docId) setBlockTranslations(cached.translations);
    },
    [],
  );

  const translateBlock = useCallback(
    async (block: StructuredBlock) => {
      const docId = activeDoc?.id;
      if (!docId) return;
      applyTranslation(docId, block.id, { status: "loading" });
      try {
        const result = await api.translateText(
          block.text,
          settings?.service || undefined,
          settings?.targetLang || undefined,
        );
        applyTranslation(
          docId,
          block.id,
          result.error
            ? { status: "error", message: result.error, result }
            : { status: "done", result },
        );
      } catch (err) {
        applyTranslation(docId, block.id, { status: "error", message: String(err) });
      }
    },
    [activeDoc, settings, applyTranslation],
  );

  const translateBlockRef = useRef(translateBlock);
  useEffect(() => {
    translateBlockRef.current = translateBlock;
  }, [translateBlock]);

  const translateContent = useCallback(async () => {
    const docId = activeDoc?.id;
    if (!docId || !structure || batchRunning) return;
    const pending = structure.blocks.filter(
      (block) =>
        CONTENT_KINDS.includes(block.kind) &&
        blockTranslations[block.id]?.status !== "done" &&
        blockTranslations[block.id]?.status !== "loading",
    );
    if (pending.length === 0) return;
    const seq = ++batchSeq.current;
    setBatchRunning(true);
    let index = 0;
    const worker = async () => {
      while (index < pending.length && seq === batchSeq.current) {
        const block = pending[index++];
        await translateBlockRef.current(block);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (seq === batchSeq.current) setBatchRunning(false);
  }, [activeDoc, structure, batchRunning, blockTranslations]);

  const cancelBatch = useCallback(() => {
    // Bumping the sequence makes every batch worker stop scheduling new blocks;
    // the few in-flight requests finish and their results are kept.
    batchSeq.current++;
    setBatchRunning(false);
  }, []);

  const handleModeChange = useCallback(
    (next: ViewMode) => {
      if (next === mode) return;
      // Leaving OCR mode also closes its panel; the panel drives OCR mode.
      if (mode === "ocr" && activePanelId === "ocr") setActivePanelId(null);
      // A translation batch targets the old block ids; stop scheduling.
      batchSeq.current++;
      setBatchRunning(false);
      if (next === "original") {
        cancelReading();
        return;
      }
      readingAbortRef.current?.abort();
      readingAbortRef.current = null;
      setStructureLoading(false);
      setExtractProgress(null);
      if (next === "ocr") setMode("ocr");
      else void startReading();
    },
    [mode, activePanelId, startReading, cancelReading],
  );

  const jumpToBlock = useCallback(
    (blockId: number) => {
      if (mode === "reading" && structure) {
        scrollToBlock(readingHostRef.current, blockId);
        return;
      }
      // From original mode: enter reading mode, then scroll once the structure
      // renders (the pending-block effect below performs the scroll).
      pendingBlockRef.current = blockId;
      void startReading();
    },
    [mode, structure, startReading],
  );

  useEffect(() => {
    if (mode !== "reading" || !structure) return;
    const blockId = pendingBlockRef.current;
    if (blockId == null) return;
    pendingBlockRef.current = null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollToBlock(readingHostRef.current, blockId)),
    );
  }, [mode, structure]);

  const refreshPlugins = useCallback(async () => {
    try {
      const [plugs, svc, cfg] = await Promise.all([
        api.listPlugins(),
        api.listServices(),
        api.getSettings(),
      ]);
      setPlugins(plugs);
      setServices(svc);
      setSettings(cfg);
    } catch (err) {
      showError(`刷新插件状态失败：${String(err)}`);
    }
  }, [showError]);

  const handleSelectionText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const seq = ++selectionSeq.current;
      setSelectionText(trimmed);
      setActivePanelId("translate");
      setSelection({ source: trimmed, status: "loading" });
      const serviceId = settings?.service || undefined;
      const serviceName =
        services.find((service) => service.id === serviceId)?.name ?? serviceId ?? "默认服务";
      try {
        const result = await api.translateText(
          trimmed,
          serviceId,
          settings?.targetLang || undefined,
        );
        if (seq === selectionSeq.current) {
          setSelection({ source: trimmed, status: "done", result, serviceName });
        }
      } catch (err) {
        if (seq === selectionSeq.current) {
          setSelection({ source: trimmed, status: "error", message: String(err) });
        }
      }
    },
    [settings, services],
  );

  const handleReaderMouseUp = useCallback(() => {
    // In OCR mode dragging selects a region for recognition instead of text.
    if (mode === "ocr") return;
    const text = window.getSelection()?.toString() ?? "";
    if (text.trim()) void handleSelectionText(text);
  }, [handleSelectionText, mode]);

  const handleSelectPanel = useCallback(
    (id: string) => {
      const next = activePanelId === id ? null : id;
      setActivePanelId(next);
      if (next === "ocr") {
        // Opening the OCR panel arms region selection on the original pages.
        if (activeDoc && content) {
          batchSeq.current++;
          setBatchRunning(false);
          readingAbortRef.current?.abort();
          readingAbortRef.current = null;
          setStructureLoading(false);
          setExtractProgress(null);
          setMode("ocr");
        }
      } else if (mode === "ocr") {
        setMode("original");
      }
    },
    [activePanelId, activeDoc, content, mode],
  );

  const handleClosePanel = useCallback(() => {
    if (activePanelId === "ocr") setMode("original");
    setActivePanelId(null);
  }, [activePanelId]);

  const panelContext = useMemo<PanelContext>(
    () => ({
      document: activeDoc,
      content,
      mode,
      structure,
      extractorRef,
      structureRef,
      outlineRef,
      readerHostRef,
      readingHostRef,
      selection,
      selectionText,
      ocr,
      services,
      settings,
      plugins,
      onUpdateSettings: updateSettings,
      onSaveSettings: handleSaveSettings,
      onTranslateSelection: (text: string) => void handleSelectionText(text),
      onRefreshPlugins: refreshPlugins,
      onShowOriginal: () => setMode("original"),
      onJumpToBlock: jumpToBlock,
      onNotify: showError,
    }),
    [
      activeDoc,
      content,
      mode,
      structure,
      selection,
      selectionText,
      ocr,
      services,
      settings,
      plugins,
      updateSettings,
      handleSaveSettings,
      handleSelectionText,
      refreshPlugins,
      jumpToBlock,
      showError,
    ],
  );

  // Reading mode scrolls the whole reader-area (its toolbar is sticky), so it
  // must NOT use the no-scroll flex layout — that clips the article with no
  // inner scroll container. Only EPUB original mode manages its own layout.
  const noScroll = content?.kind === "epub" && mode === "original";

  return (
    <div className="app">
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="banner-close" onClick={() => setError(null)} title="关闭">
            ×
          </button>
        </div>
      )}
      <div className="layout">
        <Sidebar
          documents={documents}
          collections={collections}
          pluginFormats={pluginFormats}
          activeId={activeDoc?.id ?? null}
          recentIds={recentIds}
          opening={opening}
          onOpenFiles={() => void handleOpenFiles()}
          onSelect={handleSelectDoc}
          onRemove={(doc) => void handleRemove(doc)}
          onCreateCollection={(name, parentId) => void handleCreateCollection(name, parentId)}
          onRenameCollection={(id, name) => void handleRenameCollection(id, name)}
          onDeleteCollection={(id) => void handleDeleteCollection(id)}
          onUpdateDocMeta={(id, tags, collectionIds) =>
            void handleUpdateDocMeta(id, tags, collectionIds)
          }
        />
        <main className="center" ref={centerRef}>
          <Toolbar
            title={activeDoc?.title ?? null}
            services={services}
            settings={settings}
            mode={mode}
            translating={structureLoading}
            hasDocument={!!activeDoc && !!content}
            zoom={zoom}
            onZoomChange={handleZoomChange}
            onServiceChange={(service) => updateSettings({ service })}
            onTargetChange={(targetLang) => updateSettings({ targetLang })}
            onModeChange={handleModeChange}
          />
          <div
            className={`reader-area${noScroll ? " no-scroll" : ""}`}
            onMouseUp={handleReaderMouseUp}
          >
            {!activeDoc && (
              <div className="empty-state">
                <div className="empty-state-title">ScholaRust</div>
                <div>点击左侧「打开文件」，开始沉浸式对照阅读</div>
              </div>
            )}
            {activeDoc && contentLoading && <div className="reader-status">正在加载文档…</div>}
            {activeDoc && content && (
              <>
                {mode === "ocr" && (
                  <div className="ocr-hint">
                    在页面或图片上拖动框选区域，识别结果会显示在右侧「OCR」面板
                  </div>
                )}
                <div
                  ref={readerHostRef}
                  className={`${mode === "reading" ? "reader-hidden" : "reader-host"}${mode === "ocr" ? " ocr-mode" : ""}`}
                  onPointerDown={mode === "ocr" ? handleReaderPointerDown : undefined}
                >
                  <Reader
                    key={`${content.kind}:${content.path}`}
                    content={content}
                    docId={activeDoc.id}
                    zoom={zoom}
                    extractorRef={extractorRef}
                    structureRef={structureRef}
                    readingStructureRef={readingStructureRef}
                    outlineRef={outlineRef}
                    onError={showError}
                    onSelection={handleSelectionText}
                  />
                </div>
                {mode === "reading" && (
                  <ReadingView
                    title={activeDoc.title}
                    structure={structure}
                    loading={structureLoading}
                    extractProgress={extractProgress}
                    translations={blockTranslations}
                    batchRunning={batchRunning}
                    onTranslateBlock={translateBlock}
                    onTranslateContent={() => translateContent()}
                    onCancel={cancelReading}
                    onCancelBatch={cancelBatch}
                    hostRef={readingHostRef}
                  />
                )}
              </>
            )}
          </div>
        </main>
        <RightPane
          activePanelId={activePanelId}
          context={panelContext}
          onSelectPanel={handleSelectPanel}
          onClosePanel={handleClosePanel}
          panelWidth={paneWidth}
          getMaxPanelWidth={() => centerRef.current?.clientWidth ?? 600}
          onPanelWidthChange={handlePanelWidthChange}
        />
      </div>
    </div>
  );
}