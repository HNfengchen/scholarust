import { getPanels } from "../panels/registry";
import type { PanelContext } from "../panels/registry";

interface Props {
  activePanelId: string | null;
  context: PanelContext;
  onSelectPanel: (id: string) => void;
  onClosePanel: () => void;
}

export default function RightPane({
  activePanelId,
  context,
  onSelectPanel,
  onClosePanel,
}: Props) {
  const panels = getPanels();
  const active = panels.find((panel) => panel.id === activePanelId) ?? null;
  return (
    <aside className="right-pane">
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
        <div className="panel-area">
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
