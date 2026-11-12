import { useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Collection, DocumentInfo, DocumentKind, PluginFormatFilter } from "../types";
import { KIND_FILTERS, kindClass, kindLabel } from "../types";

interface Props {
  documents: DocumentInfo[];
  collections: Collection[];
  pluginFormats: PluginFormatFilter[];
  activeId: string | null;
  recentIds: string[];
  opening: boolean;
  onOpenFiles: () => void;
  onSelect: (doc: DocumentInfo) => void;
  onRemove: (doc: DocumentInfo) => void;
  onCreateCollection: (name: string, parentId: string | null) => void;
  onRenameCollection: (id: string, name: string) => void;
  onDeleteCollection: (id: string) => void;
  onUpdateDocMeta: (id: string, tags: string[], collectionIds: string[]) => void;
}

interface MenuState {
  kind: "collection" | "row";
  id: string;
  x: number;
  y: number;
}

export default function Sidebar({
  documents,
  collections,
  pluginFormats,
  activeId,
  recentIds,
  opening,
  onOpenFiles,
  onSelect,
  onRemove,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onUpdateDocMeta,
}: Props) {
  const [selectedKey, setSelectedKey] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuCollectionsOpen, setMenuCollectionsOpen] = useState(false);

  const kindCounts = useMemo(() => {
    const counts = new Map<DocumentKind, number>();
    for (const doc of documents) {
      counts.set(doc.kind, (counts.get(doc.kind) ?? 0) + 1);
    }
    return counts;
  }, [documents]);

  const pluginFormatCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const format of pluginFormats) {
      counts.set(
        format.key,
        documents.filter((doc) => format.extensions.some((ext) => doc.kind === `plugin:${ext}`))
          .length,
      );
    }
    return counts;
  }, [pluginFormats, documents]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of documents) {
      for (const tag of doc.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [documents]);

  const descendantIds = (rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    const walk = (parentId: string) => {
      for (const collection of collections) {
        if (collection.parentId === parentId && !ids.has(collection.id)) {
          ids.add(collection.id);
          walk(collection.id);
        }
      }
    };
    walk(rootId);
    return ids;
  };

  const filteredDocs = useMemo(() => {
    if (selectedKey === "recent") {
      return recentIds
        .map((id) => documents.find((doc) => doc.id === id))
        .filter((doc): doc is DocumentInfo => !!doc);
    }
    if (selectedKey.startsWith("col:")) {
      const ids = descendantIds(selectedKey.slice(4));
      return documents.filter((doc) => (doc.collectionIds ?? []).some((id) => ids.has(id)));
    }
    if (selectedKey.startsWith("kind:")) {
      const kind = selectedKey.slice(5) as DocumentKind;
      return documents.filter((doc) => doc.kind === kind);
    }
    if (selectedKey.startsWith("plugin-format:")) {
      const format = pluginFormats.find((entry) => entry.key === selectedKey);
      return format
        ? documents.filter((doc) => format.extensions.some((ext) => doc.kind === `plugin:${ext}`))
        : [];
    }
    if (selectedKey.startsWith("tag:")) {
      const tag = selectedKey.slice(4);
      return documents.filter((doc) => (doc.tags ?? []).includes(tag));
    }
    return documents;
  }, [selectedKey, documents, collections, recentIds, pluginFormats]);

  const nodeTitle = useMemo(() => {
    if (selectedKey === "recent") return "最近打开";
    if (selectedKey.startsWith("col:")) {
      return collections.find((collection) => collection.id === selectedKey.slice(4))?.name ?? "收藏夹";
    }
    if (selectedKey.startsWith("kind:")) {
      return KIND_FILTERS.find((filter) => filter.kind === selectedKey.slice(5))?.label ?? "格式";
    }
    if (selectedKey.startsWith("plugin-format:")) {
      return pluginFormats.find((format) => format.key === selectedKey)?.label ?? "格式";
    }
    if (selectedKey.startsWith("tag:")) return `标签：${selectedKey.slice(4)}`;
    return "全部文档";
  }, [selectedKey, collections, pluginFormats]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMenu = (event: ReactMouseEvent, kind: MenuState["kind"], id: string) => {
    event.stopPropagation();
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuCollectionsOpen(false);
    setMenu((prev) =>
      prev && prev.kind === kind && prev.id === id
        ? null
        : { kind, id, x: Math.min(rect.left, window.innerWidth - 220), y: rect.bottom + 2 },
    );
  };

  const closeMenu = () => {
    setMenu(null);
    setMenuCollectionsOpen(false);
  };

  const promptCreateCollection = (parentId: string | null) => {
    const name = window.prompt(parentId ? "子收藏夹名称" : "收藏夹名称");
    if (name && name.trim()) onCreateCollection(name.trim(), parentId);
    closeMenu();
  };

  const promptRenameCollection = (collection: Collection) => {
    const name = window.prompt("重命名收藏夹", collection.name);
    if (name && name.trim() && name.trim() !== collection.name) {
      onRenameCollection(collection.id, name.trim());
    }
    closeMenu();
  };

  const confirmDeleteCollection = (collection: Collection) => {
    closeMenu();
    if (window.confirm(`确定删除收藏夹「${collection.name}」吗？其中的文档不会从文库移除。`)) {
      onDeleteCollection(collection.id);
      if (selectedKey === `col:${collection.id}`) setSelectedKey("all");
    }
  };

  const promptEditTags = (doc: DocumentInfo) => {
    const input = window.prompt("标签（逗号分隔）", (doc.tags ?? []).join(", "));
    closeMenu();
    if (input == null) return;
    const tags = Array.from(
      new Set(
        input
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
      ),
    );
    onUpdateDocMeta(doc.id, tags, doc.collectionIds ?? []);
  };

  const toggleDocCollection = (doc: DocumentInfo, collectionId: string) => {
    const current = doc.collectionIds ?? [];
    const next = current.includes(collectionId)
      ? current.filter((id) => id !== collectionId)
      : [...current, collectionId];
    onUpdateDocMeta(doc.id, doc.tags ?? [], next);
  };

  const renderCollectionNode = (collection: Collection, depth: number): JSX.Element => {
    const children = collections.filter((item) => item.parentId === collection.id);
    const isOpen = expanded.has(collection.id);
    const key = `col:${collection.id}`;
    return (
      <div key={collection.id}>
        <div
          className={`tree-row${selectedKey === key ? " selected" : ""}`}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          onClick={() => setSelectedKey(key)}
        >
          <span
            className="tree-caret"
            onClick={(event) => {
              event.stopPropagation();
              if (children.length > 0) toggleExpand(collection.id);
            }}
          >
            {children.length > 0 ? (isOpen ? "▾" : "▸") : ""}
          </span>
          <span className="tree-label">{collection.name}</span>
          <button
            className="tree-menu-btn"
            title="收藏夹操作"
            onClick={(event) => openMenu(event, "collection", collection.id)}
          >
            ⋯
          </button>
        </div>
        {isOpen && children.map((child) => renderCollectionNode(child, depth + 1))}
      </div>
    );
  };

  const rootCollections = collections.filter((collection) => collection.parentId == null);
  const menuCollection =
    menu?.kind === "collection" ? collections.find((item) => item.id === menu.id) ?? null : null;
  const menuDoc = menu?.kind === "row" ? documents.find((doc) => doc.id === menu.id) ?? null : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="app-name">ScholaRust</h1>
        <button className="btn btn-primary open-btn" onClick={onOpenFiles} disabled={opening}>
          {opening ? "正在打开…" : "打开文件"}
        </button>
      </div>

      <nav className="nav-tree">
        <div
          className={`tree-row${selectedKey === "all" ? " selected" : ""}`}
          onClick={() => setSelectedKey("all")}
        >
          <span className="tree-caret" />
          <span className="tree-label">全部文档</span>
          <span className="count-badge">{documents.length}</span>
        </div>
        <div
          className={`tree-row${selectedKey === "recent" ? " selected" : ""}`}
          onClick={() => setSelectedKey("recent")}
        >
          <span className="tree-caret" />
          <span className="tree-label">最近打开</span>
        </div>

        <div className="tree-group">
          <div className="tree-group-header">
            <span>收藏夹</span>
            <button
              className="tree-add-btn"
              title="新建收藏夹"
              onClick={() => promptCreateCollection(null)}
            >
              +
            </button>
          </div>
          {rootCollections.length === 0 && <div className="empty-hint">暂无收藏夹</div>}
          {rootCollections.map((collection) => renderCollectionNode(collection, 0))}
        </div>

        <div className="tree-group">
          <div className="tree-group-header">
            <span>按格式</span>
          </div>
          <div className="kind-filter">
            <select
              value={
                selectedKey.startsWith("kind:")
                  ? selectedKey.slice(5)
                  : selectedKey.startsWith("plugin-format:")
                    ? selectedKey
                    : ""
              }
              onChange={(event) => {
                const value = event.target.value;
                if (!value) setSelectedKey("all");
                else if (value.startsWith("plugin-format:")) setSelectedKey(value);
                else setSelectedKey(`kind:${value}`);
              }}
              title="按文档格式筛选"
            >
              <option value="">全部格式（{documents.length}）</option>
              {KIND_FILTERS.map((filter) => (
                <option key={filter.kind} value={filter.kind}>
                  {filter.label}（{kindCounts.get(filter.kind) ?? 0}）
                </option>
              ))}
              {pluginFormats.map((format) => (
                <option key={format.key} value={format.key}>
                  {format.label}（{pluginFormatCounts.get(format.key) ?? 0}）
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="tree-group">
          <div className="tree-group-header">
            <span>标签</span>
          </div>
          {tagCounts.length === 0 && <div className="empty-hint">暂无标签</div>}
          {tagCounts.map(([tag, count]) => (
            <div
              key={tag}
              className={`tree-row${selectedKey === `tag:${tag}` ? " selected" : ""}`}
              onClick={() => setSelectedKey(`tag:${tag}`)}
            >
              <span className="tree-caret" />
              <span className="tree-label">{tag}</span>
              <span className="count-badge">{count}</span>
            </div>
          ))}
        </div>
      </nav>

      <div className="doc-list">
        <div className="doc-list-header">
          {nodeTitle} · {filteredDocs.length}
        </div>
        {filteredDocs.length === 0 && <div className="empty-hint">此分类下暂无文档</div>}
        {filteredDocs.map((doc) => (
          <div
            key={doc.id}
            className={`doc-item${doc.id === activeId ? " active" : ""}`}
            onClick={() => onSelect(doc)}
            title={doc.path}
          >
            <span className={kindClass(doc.kind)}>{kindLabel(doc.kind)}</span>
            <span className="doc-title">{doc.title}</span>
            <span className="doc-tags">
              {(doc.tags ?? []).slice(0, 3).map((tag) => (
                <span key={tag} className="tag-chip">
                  {tag}
                </span>
              ))}
            </span>
            <button
              className="tree-menu-btn doc-menu-btn"
              title="文档操作"
              onClick={(event) => openMenu(event, "row", doc.id)}
            >
              ⋯
            </button>
          </div>
        ))}
      </div>

      {menu && (
        <>
          <div className="popover-backdrop" onClick={closeMenu} onContextMenu={(event) => { event.preventDefault(); closeMenu(); }} />
          <div className="popover-menu" style={{ left: menu.x, top: menu.y }}>
            {menu.kind === "collection" && menuCollection && (
              <>
                <button className="popover-item" onClick={() => promptCreateCollection(menuCollection.id)}>
                  新建子收藏夹
                </button>
                <button className="popover-item" onClick={() => promptRenameCollection(menuCollection)}>
                  重命名
                </button>
                <button className="popover-item danger" onClick={() => confirmDeleteCollection(menuCollection)}>
                  删除
                </button>
              </>
            )}
            {menu.kind === "collection" && !menuCollection && (
              <div className="empty-hint">收藏夹不存在</div>
            )}
            {menu.kind === "row" && menuDoc && (
              <>
                <button
                  className="popover-item"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuCollectionsOpen((prev) => !prev);
                  }}
                >
                  添加到收藏夹 {menuCollectionsOpen ? "▾" : "▸"}
                </button>
                {menuCollectionsOpen && (
                  <div className="popover-sublist">
                    {collections.length === 0 && <div className="empty-hint">暂无收藏夹</div>}
                    {collections.map((collection) => (
                      <label key={collection.id} className="popover-check">
                        <input
                          type="checkbox"
                          checked={(menuDoc.collectionIds ?? []).includes(collection.id)}
                          onChange={() => toggleDocCollection(menuDoc, collection.id)}
                        />
                        <span>{collection.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <button className="popover-item" onClick={() => promptEditTags(menuDoc)}>
                  编辑标签
                </button>
                <button
                  className="popover-item danger"
                  onClick={() => {
                    closeMenu();
                    onRemove(menuDoc);
                  }}
                >
                  从文库移除
                </button>
              </>
            )}
            {menu.kind === "row" && !menuDoc && <div className="empty-hint">文档不存在</div>}
          </div>
        </>
      )}
    </aside>
  );
}
