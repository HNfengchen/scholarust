import type { MutableRefObject } from "react";
import { convertFileSrc } from "../api";
import type { DocumentContent, ParagraphExtractor } from "../types";
import type { ReadingStructureExtractor, StructureExtractor } from "../structure";
import PdfReader from "../readers/PdfReader";
import EpubReader from "../readers/EpubReader";
import HtmlReader from "../readers/HtmlReader";

interface Props {
  content: DocumentContent;
  extractorRef: MutableRefObject<ParagraphExtractor | null>;
  structureRef: MutableRefObject<StructureExtractor | null>;
  readingStructureRef: MutableRefObject<ReadingStructureExtractor | null>;
  onError: (message: string) => void;
  onSelection: (text: string) => void;
}

export default function Reader({ content, extractorRef, structureRef, readingStructureRef, onError, onSelection }: Props) {
  const url = convertFileSrc(content.path);
  switch (content.kind) {
    case "pdf":
      return (
        <PdfReader
          url={url}
          extractorRef={extractorRef}
          structureRef={structureRef}
          readingStructureRef={readingStructureRef}
          onError={onError}
        />
      );
    case "epub":
      return (
        <EpubReader
          url={url}
          extractorRef={extractorRef}
          structureRef={structureRef}
          readingStructureRef={readingStructureRef}
          onError={onError}
          onSelection={onSelection}
        />
      );
    case "docx":
      return (
        <HtmlReader
          html={null}
          docxUrl={url}
          extractorRef={extractorRef}
          structureRef={structureRef}
          readingStructureRef={readingStructureRef}
          onError={onError}
        />
      );
    default:
      return (
        <HtmlReader
          html={content.html}
          docxUrl={null}
          extractorRef={extractorRef}
          structureRef={structureRef}
          readingStructureRef={readingStructureRef}
          onError={onError}
        />
      );
  }
}