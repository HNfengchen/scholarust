import { useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { getPanels } from "../panels/registry";
import type { PanelContext } from "../panels/registry";
import { pluginPanelDescriptors } from "../panels/pluginPanels";

export const MIN_PANEL_WIDTH = 240;

interface Props {
  activePanelId: string | null;
  context: PanelContext;
  onSelectPanel: (id: string) => void;
  onClosePanel: () => void;
  panelWidth: number;
  getMaxPanelWidth: () => number;
  onPanelWidthChange: (width: number) => void;
}

export default function RightPane({
  activePanelId,
  context,
  onSelectPanel,
  onClosePanel,
  panelWidth,
  getMaxPanelWidth,
  onPanelWidthChange,
}: Props) {
  const panels = useMemo(
    () => [...getPanels(), ...pluginPanelDescriptors(context.plugins)],
    [context.plugins],
  );
  const active = panels.find((panel) => panel.id === activePanelId) ?? null;
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleDragStart = (event: ReactMouseEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: panelWidth };
    const cleanup = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    const handleMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = drag.startWidth + (drag.startX - ev.clientX);
      if (next < MIN_PANEL_WIDTH) {
        cleanup();
        onClosePanel();
        return;
      }
      onPanelWidthChange(Math.min(next, getMaxPanelWidth()));
    };
    const handleUp = () => cleanup();
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <aside className="right-pane">
      {active && (
        <div
          className="pane-resize-handle"
          title="拖动调整宽度，拖到最窄自动收起"
          onMouseDown={handleDragStart}
        />
      )}
      <div className="activity-bar">
        {panels.map((panel) => (
          <button
            key={panel.id}
            className={`activity-btn${panel.id === activePanelId ? " active" : ""}`}
            title={panel.title}
            onClick={() => onSelectPanel(panel.id)}
          >
            <span
              className="activity-icon"
              dangerouslySetInnerHTML={{ __html: panel.icon }}
            />
          </button>
        ))}
      </div>
      {active && (
        <div className="panel-area" style={{ width: panelWidth }}>
          <div className="panel-header">
            <span>{active.title}</span>
            <button className="icon-btn" onClick={onClosePanel} title="收起面板">
              ×
            </button>
          </div>
          <active.render {...context} />
        </div>
      )}
    </aside>
  );
}