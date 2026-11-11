import type { MutableRefObject } from "react";
import { convertFileSrc } from "../api";
import type { DocumentContent, ParagraphExtractor } from "../types";
import type { ReadingStructureExtractor, StructureExtractor } from "../structure";
import type { OutlineExtractor } from "../outline";
import PdfReader from "../readers/PdfReader";
import EpubReader from "../readers/EpubReader";
import HtmlReader from "../readers/HtmlReader";

interface Props {
  content: DocumentContent;
  docId: string;
  zoom: number;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  outlineRef: MutableRefObject<OutlineExtractor | null>;
  onError: (message: string) => void;
  onSelection: (text: string) => void;
}

export default function Reader({
  content,
  docId,
  zoom,
  extractorRef,
  structureRef,
  readingStructureRef,
  outlineRef,
  onError,
  onSelection,
}: Props) {
  const url = convertFileSrc(content.path);
  switch (content.kind) {
    case "pdf":
      return (
        <PdfReader
          url={url}
          zoom={zoom}
          extractorRef={extractorRef}
          structureRef={structureRef}
          readingStructureRef={readingStructureRef}
          outlineRef={outlineRef}
          onError={onError}
        />
      );
    case "epub":
      return (
        <EpubReader
          url={url}
          docId={docId}
          zoom={zoom}
          extractorRef={extractorRef}
          structureRef={structureRef}
          readingStructureRef={readingStructureRef}
          outlineRef={outlineRef}
          onError={onError}
          onSelection={onSelection}
        />
      );
    case "docx":
      return (
        <HtmlReader
          html={null}
          docxUrl={url}
          docId={docId}
          zoom={zoom}
          extractorRef={extractorRef}
          structureRef={structureRef}
          readingStructureRef={readingStructureRef}
          outlineRef={outlineRef}
          onError={onError}
        />
      );
    default:
      return (
        <HtmlReader
          html={content.html}
          docxUrl={null}
          docId={docId}
          zoom={zoom}
          extractorRef={extractorRef}
          structureRef={structureRef}
          readingStructureRef={readingStructureRef}
          outlineRef={outlineRef}
          onError={onError}
        />
      );
  }
}
