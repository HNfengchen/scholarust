import type { PluginPanel } from "../types";

/** Render declarative plugin content. Only text nodes and fixed elements —
 * a plugin can never inject HTML or script into the app window. */
export default function PluginContributions({ panels }: { panels: PluginPanel[] }) {
  if (panels.length === 0) return null;
  return (
    <div className="plugin-contributions">
      {panels.map((panel) => (
        <section key={panel.id} className="plugin-contribution">
          <h4>{panel.title}</h4>
          {panel.description && <p className="extension-desc">{panel.description}</p>}
          {panel.sections.map((section, index) => {
            if (section.type === "paragraph") {
              return <p key={index}>{section.text}</p>;
            }
            if (section.type === "list") {
              return (
                <ul key={index}>
                  {section.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ul>
              );
            }
            return (
              <dl key={index} className="plugin-contribution-kv">
                {section.items.map((item, itemIndex) => (
                  <div key={itemIndex}>
                    <dt>{item.key}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            );
          })}
        </section>
      ))}
    </div>
  );
}
