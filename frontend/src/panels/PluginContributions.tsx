import { useState } from "react";
import PluginChart from "./PluginChart";
import type {
  PluginActionValues,
  PluginFormField,
  PluginPanel,
  PluginPanelActionItem,
  PluginPanelSection,
} from "../types";

type Handler = (panelId: string, actionId: string, values?: PluginActionValues) => void;

function ActionsSection({
  panelId,
  items,
  onAction,
  busy,
}: {
  panelId: string;
  items: PluginPanelActionItem[];
  onAction?: Handler;
  busy: string | null;
}) {
  return (
    <div className="plugin-actions">
      {items.map((item) => {
        const key = `${panelId}:${item.id}`;
        const tone =
          item.tone === "primary" ? "btn btn-primary" : item.tone === "danger" ? "btn btn-danger" : "btn";
        return (
          <button
            key={item.id}
            type="button"
            className={`${tone} btn-small`}
            disabled={!onAction || item.disabled || busy === key}
            onClick={() => onAction?.(panelId, item.id)}
          >
            {busy === key ? (
              <>
                <span className="spinner" /> {item.label}
              </>
            ) : (
              item.label
            )}
          </button>
        );
      })}
    </div>
  );
}

type FormState = Record<string, string | boolean>;

function initialValue(field: PluginFormField): string | boolean {
  if (field.kind === "checkbox") return field.value === true;
  return field.value == null ? "" : String(field.value);
}

function FormSection({
  panelId,
  formId,
  submitLabel,
  fields,
  onAction,
  busy,
}: {
  panelId: string;
  formId: string;
  submitLabel: string;
  fields: PluginFormField[];
  onAction?: Handler;
  busy: string | null;
}) {
  const [values, setValues] = useState<FormState>(() =>
    Object.fromEntries(fields.map((field) => [field.id, initialValue(field)])),
  );
  const readOnly = !onAction;
  const key = `${panelId}:${formId}`;
  const update = (id: string, value: string | boolean) =>
    setValues((prev) => ({ ...prev, [id]: value }));

  const submit = () => {
    const payload: PluginActionValues = {};
    for (const field of fields) {
      const value = values[field.id];
      if (field.kind === "number") {
        payload[field.id] = typeof value === "string" && value.trim() !== "" ? Number(value) : null;
      } else if (field.kind === "checkbox") {
        payload[field.id] = value === true;
      } else {
        payload[field.id] = typeof value === "string" ? value : "";
      }
    }
    onAction?.(panelId, formId, payload);
  };

  return (
    <form
      className="plugin-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {fields.map((field) => {
        const controlId = `${panelId}-${formId}-${field.id}`;
        const value = values[field.id];
        if (field.kind === "checkbox") {
          return (
            <label key={field.id} className="plugin-form-checkbox" htmlFor={controlId}>
              <input
                id={controlId}
                type="checkbox"
                checked={value === true}
                disabled={readOnly}
                onChange={(event) => update(field.id, event.target.checked)}
              />
              {field.label}
            </label>
          );
        }
        return (
          <label key={field.id} className="plugin-form-field" htmlFor={controlId}>
            <span>{field.label}</span>
            {field.kind === "textarea" ? (
              <textarea
                id={controlId}
                value={typeof value === "string" ? value : ""}
                placeholder={field.placeholder}
                required={field.required}
                disabled={readOnly}
                rows={3}
                onChange={(event) => update(field.id, event.target.value)}
              />
            ) : field.kind === "select" ? (
              <select
                id={controlId}
                value={typeof value === "string" ? value : ""}
                required={field.required}
                disabled={readOnly}
                onChange={(event) => update(field.id, event.target.value)}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label || option.value}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={controlId}
                type={field.kind === "number" ? "number" : "text"}
                value={typeof value === "string" ? value : ""}
                placeholder={field.placeholder}
                required={field.required}
                disabled={readOnly}
                min={field.kind === "number" ? field.min : undefined}
                max={field.kind === "number" ? field.max : undefined}
                onChange={(event) => update(field.id, event.target.value)}
              />
            )}
          </label>
        );
      })}
      <button className="btn btn-primary btn-small" type="submit" disabled={readOnly || busy === key}>
        {busy === key ? (
          <>
            <span className="spinner" /> {submitLabel}
          </>
        ) : (
          submitLabel
        )}
      </button>
    </form>
  );
}

function Section({
  panelId,
  section,
  onAction,
  busy,
}: {
  panelId: string;
  section: PluginPanelSection;
  onAction?: Handler;
  busy: string | null;
}) {
  if (section.type === "paragraph") return <p>{section.text}</p>;
  if (section.type === "list") {
    return (
      <ul>
        {section.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  }
  if (section.type === "keyValue") {
    return (
      <dl className="plugin-contribution-kv">
        {section.items.map((item, index) => (
          <div key={index}>
            <dt>{item.key}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (section.type === "actions") {
    return <ActionsSection panelId={panelId} items={section.items} onAction={onAction} busy={busy} />;
  }
  if (section.type === "form") {
    return (
      <FormSection
        panelId={panelId}
        formId={section.id}
        submitLabel={section.submitLabel || "提交"}
        fields={section.fields}
        onAction={onAction}
        busy={busy}
      />
    );
  }
  return <PluginChart chart={section} />;
}

/** Render declarative plugin content. Only fixed elements and text nodes —
 * a plugin can never inject HTML or script into the app window. Buttons and
 * forms only call the plugin's `action` export. */
export default function PluginContributions({
  panels,
  onAction,
  busy = null,
}: {
  panels: PluginPanel[];
  onAction?: Handler;
  busy?: string | null;
}) {
  if (panels.length === 0) return null;
  return (
    <div className="plugin-contributions">
      {panels.map((panel) => (
        <section key={panel.id} className="plugin-contribution">
          <h4>{panel.title}</h4>
          {panel.description && <p className="extension-desc">{panel.description}</p>}
          {panel.sections.map((section, index) => (
            <Section
              key={`${section.type}-${index}`}
              panelId={panel.id}
              section={section}
              onAction={onAction}
              busy={busy}
            />
          ))}
        </section>
      ))}
    </div>
  );
}