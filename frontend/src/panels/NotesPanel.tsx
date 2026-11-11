import { useEffect, useState } from "react";
import { addNote, deleteNote, listNotes } from "../api";
import type { Note } from "../types";
import { filterAndGroupNotes } from "./notes";
import type { PanelContext } from "./registry";

export default function NotesPanel({ document, selectionText, onNotify }: PanelContext) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const docId = document?.id ?? null;

  useEffect(() => {
    setNotes([]);
    setDraft("");
    setPendingQuote(null);
    setQuery("");
    setExpandedDates(new Set());
    if (!docId) return;
    let cancelled = false;
    setLoading(true);
    listNotes(docId)
      .then((loaded) => {
        if (!cancelled) setNotes(loaded);
      })
      .catch((err) => {
        if (!cancelled) onNotify(`笔记加载失败：${String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docId, onNotify]);

  const handleSave = async () => {
    const text = draft.trim();
    if (!docId || saving || (!text && !pendingQuote)) return;
    setSaving(true);
    try {
      const note = await addNote(docId, text, pendingQuote ?? undefined);
      setNotes((prev) => [note, ...prev]);
      setDraft("");
      setPendingQuote(null);
      const dateKey = new Date(note.createdAt).toLocaleDateString();
      setExpandedDates((prev) => new Set(prev).add(dateKey));
    } catch (err) {
      onNotify(`笔记保存失败：${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!docId) return;
    try {
      await deleteNote(docId, noteId);
      setNotes((prev) => prev.filter((note) => note.id !== noteId));
    } catch (err) {
      onNotify(`笔记删除失败：${String(err)}`);
    }
  };

  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const searching = query.trim().length > 0;
  const groups = filterAndGroupNotes(notes, query);

  return (
    <div className="panel-body notes-body">
      {!document && <div className="empty-hint">未打开文档</div>}
      {document && (
        <>
          <div className="notes-toolbar">
            <button
              className={`icon-btn notes-search-toggle${searchOpen ? " active" : ""}`}
              title="搜索笔记"
              onClick={() => {
                setSearchOpen((open) => !open);
                setQuery("");
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
            </button>
            {selectionText && (
              <button
                className="btn btn-small"
                title={selectionText}
                onClick={() => setPendingQuote(selectionText)}
              >
                摘录选中文字
              </button>
            )}
          </div>
          {searchOpen && (
            <input
              className="notes-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索笔记内容…"
              autoFocus
            />
          )}
          <div className="notes-composer">
            {pendingQuote && (
              <div className="note-quote notes-pending-quote">
                <div className="pending-quote-text">{pendingQuote}</div>
                <button
                  className="pending-quote-remove"
                  title="移除摘录"
                  onClick={() => setPendingQuote(null)}
                >
                  ×
                </button>
              </div>
            )}
            <textarea
              className="notes-textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                pendingQuote ? "在摘录下方写点内容…（也可只保存摘录）" : "写一条笔记，每次保存为独立的一条"
              }
            />
            <button
              className="btn btn-primary btn-small"
              disabled={saving || (!draft.trim() && !pendingQuote)}
              onClick={() => void handleSave()}
            >
              {saving ? "保存中…" : "保存笔记"}
            </button>
          </div>
          <div className="notes-list">
            {loading && <div className="empty-hint">正在载入笔记…</div>}
            {!loading && groups.length === 0 && (
              <div className="empty-hint">
                {searching ? "没有匹配的笔记" : "暂无笔记，可在阅读器中选中文字后摘录"}
              </div>
            )}
            {groups.map(([date, items]) => {
              const open = searching || expandedDates.has(date);
              return (
                <div key={date} className="notes-group">
                  <button className="notes-date" onClick={() => toggleDate(date)}>
                    <span className={`notes-chevron${open ? " open" : ""}`}>▸</span>
                    {date}
                    <span className="notes-count">{items.length}</span>
                  </button>
                  {open &&
                    items.map((note) => (
                      <div key={note.id} className="note-item">
                        {note.quote && <div className="note-quote">{note.quote}</div>}
                        {note.text && <div className="note-text">{note.text}</div>}
                        <div className="note-meta">
                          <span>{new Date(note.createdAt).toLocaleTimeString()}</span>
                          <button className="btn-link" onClick={() => void handleDelete(note.id)}>
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}