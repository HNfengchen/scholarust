import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import * as api from "../api";
import type { DocumentStructure, ReadingStructureExtractor, StructureExtractor } from "../structure";
import type { BlockKind } from "../structure";
import type { OutlineExtractor, OutlineEntry } from "../outline";
import type { ParagraphExtractor } from "../types";

interface Props {
  docId: string;
  zoom: number;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  outlineRef: MutableRefObject<OutlineExtractor | null>;
  onError: (message: string) => void;
}

function toStructure(parsed: api.ParsedDocumentPayload): DocumentStructure {
  return {
    removedLines: 0,
    notice: parsed.notice ?? undefined,
    blocks: parsed.blocks.map((block) => ({
      id: block.id,
      kind: block.kind as BlockKind,
      text: block.text,
      page: null,
      level: block.level,
      image: block.image,
      caption: block.kind === "figure" ? block.text : undefined,
    })),
  };
}

function outlineOf(structure: DocumentStructure): OutlineEntry[] {
  return structure.blocks
    .filter((block) => block.kind === "title" || block.kind === "heading")
    .map((block) => ({
      id: `plugin-${block.id}`,
      text: block.text,
      level: block.kind === "title" ? 1 : block.level || 1,
    }));
}

/** Reader for formats handled by a parser plugin. The host does the parsing;
 * this component only renders the returned structured blocks. */
export default function ParsedReader({
  docId,
  zoom,
  extractorRef,
  structureRef,
  readingStructureRef,
  outlineRef,
  onError,
}: Props) {
  const cacheRef = useRef(new Map<string, Promise<DocumentStructure>>());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rawText, setRawText] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const pending =
      cacheRef.current.get(docId) ??
      api.parseDocument(docId).then((parsed) => {
        const structure = toStructure(parsed);
        cacheRef.current.set(docId, Promise.resolve(structure));
        return structure;
      });
    cacheRef.current.set(docId, pending);

    const load = async (signal?: AbortSignal): Promise<DocumentStructure> => {
      signal?.throwIfAborted();
      const structure = await pending;
      signal?.throwIfAborted();
      return structure;
    };

    extractorRef.current = async () =>
      (await load()).blocks.map((block) => ({ text: block.text, page: null }));
    structureRef.current = () => load();
    readingStructureRef.current = (_onProgress, signal) => load(signal);
    outlineRef.current = async () => outlineOf(await load());

    setStatus("loading");
    setMessage("");
    pending.then(
      (structure) => {
        if (cancelled) return;
        setStatus("ready");
        setRawText(
          structure.blocks
            .map((block) => block.text.trim())
            .filter(Boolean)
            .join("\n\n"),
        );
      },
      (error) => {
        if (cancelled) return;
        cacheRef.current.delete(docId);
        const text = `插件解析失败：${String(error)}`;
        setStatus("error");
        setMessage(text);
        onError(text);
      },
    );

    return () => {
      cancelled = true;
      extractorRef.current = null;
      structureRef.current = null;
      readingStructureRef.current = null;
      outlineRef.current = null;
    };
  }, [docId, extractorRef, structureRef, readingStructureRef, outlineRef, onError]);

  return (
    <div className="html-reader-wrap">
      {status === "loading" && <div className="reader-status">正在通过插件解析…</div>}
      {status === "error" && <div className="reader-status reader-error-text">{message}</div>}
      {status === "ready" && (
        <pre className="raw-text parsed-text" style={{ zoom }}>
          {rawText}
        </pre>
      )}
    </div>
  );
}
