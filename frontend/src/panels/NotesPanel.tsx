import { useEffect, useRef, useState } from "react";
import { getNotes, saveNotes } from "../api";
import type { PanelContext } from "./registry";

export default function NotesPanel({ document, onNotify }: PanelContext) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<number | null>(null);
  const docId = document?.id ?? null;

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSavedAt(null);
    if (!docId) {
      setText("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    getNotes(docId)
      .then((content) => {
        if (!cancelled) setText(content);
      })
      .catch((err) => {
        if (!cancelled) onNotify(`笔记加载失败：${String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [docId, onNotify]);

  const scheduleSave = (value: string) => {
    setText(value);
    if (!docId) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      saveNotes(docId, value)
        .then(() => setSavedAt(new Date()))
        .catch((err) => onNotify(`笔记保存失败：${String(err)}`));
    }, 800);
  };

  return (
    <div className="panel-body notes-body">
      {!document && <div className="empty-hint">未打开文档</div>}
      {document && (
        <>
          <textarea
            className="notes-textarea"
            value={text}
            placeholder={loading ? "正在载入笔记…" : "在此记录阅读笔记，自动保存"}
            onChange={(event) => scheduleSave(event.target.value)}
            disabled={loading}
          />
          <div className="notes-footer">
            {savedAt ? `已保存 ${savedAt.toLocaleTimeString()}` : loading ? "载入中…" : ""}
          </div>
        </>
      )}
    </div>
  );
}
