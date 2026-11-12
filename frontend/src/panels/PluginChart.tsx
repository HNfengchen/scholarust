import type { PluginPanelChart } from "../types";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b"];
const W = 360;
const H = 190;
const LEFT = 38;
const RIGHT = 12;
const TOP = 16;
const BOTTOM = 34;

function polar(cx: number, cy: number, r: number, angle: number) {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
}

function pieSlice(cx: number, cy: number, r: number, start: number, end: number): string {
  const [x1, y1] = polar(cx, cy, r, start);
  const [x2, y2] = polar(cx, cy, r, end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/** Renders plugin-provided chart data with plain SVG (no HTML from plugins). */
export default function PluginChart({ chart }: { chart: PluginPanelChart }) {
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const n = chart.labels.length;

  if (chart.kind === "pie") {
    const values = chart.series[0]?.values ?? [];
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
    const cx = W / 2;
    const cy = H / 2 + 4;
    let angle = -Math.PI / 2;
    const slices = values.map((value, index) => {
      const sweep = total > 0 ? (Math.max(0, value) / total) * Math.PI * 2 : 0;
      const slice = { path: pieSlice(cx, cy, 68, angle, angle + sweep), color: COLORS[index % COLORS.length] };
      angle += sweep;
      return slice;
    });
    return (
      <figure className="plugin-chart">
        {chart.title && <figcaption className="plugin-chart-title">{chart.title}</figcaption>}
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title || "饼图"}>
          {total > 0 ? (
            slices.map((slice, index) => (
              <path key={index} d={slice.path} fill={slice.color} stroke="#fff" strokeWidth="1.5" />
            ))
          ) : (
            <text x={cx} y={cy} textAnchor="middle" fill="#6b7280" fontSize="12">
              无数据
            </text>
          )}
        </svg>
        <div className="plugin-chart-legend">
          {chart.labels.map((label, index) => (
            <span key={index}>
              <i style={{ background: COLORS[index % COLORS.length] }} />
              {label}
            </span>
          ))}
        </div>
      </figure>
    );
  }

  const all = chart.series.flatMap((series) => series.values);
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all);
  const span = max - min || 1;
  const y = (value: number) => TOP + ((max - value) / span) * plotH;
  const slot = plotW / Math.max(1, n);
  const baseline = y(0);

  return (
    <figure className="plugin-chart">
      {chart.title && <figcaption className="plugin-chart-title">{chart.title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title || "图表"}>
        <line x1={LEFT} y1={TOP} x2={LEFT} y2={TOP + plotH} stroke="#d1d5db" strokeWidth="1" />
        <line x1={LEFT} y1={baseline} x2={W - RIGHT} y2={baseline} stroke="#9ca3af" strokeWidth="1" />
        <text x={LEFT - 4} y={TOP + 8} textAnchor="end" fontSize="9" fill="#6b7280">
          {max.toFixed(1)}
        </text>
        <text x={LEFT - 4} y={TOP + plotH} textAnchor="end" fontSize="9" fill="#6b7280">
          {min.toFixed(1)}
        </text>
        {chart.labels.map((label, index) => (
          <text
            key={`label-${index}`}
            x={LEFT + slot * (index + 0.5)}
            y={H - BOTTOM + 16}
            textAnchor="middle"
            fontSize="9"
            fill="#6b7280"
          >
            {label.length > 10 ? `${label.slice(0, 10)}…` : label}
          </text>
        ))}
        {chart.kind === "bar"
          ? chart.series.map((series, seriesIndex) => {
              const barW = (slot * 0.7) / chart.series.length;
              return series.values.map((value, index) => {
                const x = LEFT + slot * index + slot * 0.15 + barW * seriesIndex;
                const top = Math.min(y(value), baseline);
                return (
                  <rect
                    key={`${seriesIndex}-${index}`}
                    x={x}
                    y={top}
                    width={barW}
                    height={Math.max(1, Math.abs(baseline - y(value)))}
                    fill={COLORS[seriesIndex % COLORS.length]}
                    rx="2"
                  />
                );
              });
            })
          : chart.series.map((series, seriesIndex) => (
              <polyline
                key={seriesIndex}
                fill="none"
                stroke={COLORS[seriesIndex % COLORS.length]}
                strokeWidth="2"
                points={series.values
                  .map((value, index) => `${LEFT + (n === 1 ? plotW / 2 : (index / (n - 1)) * plotW)},${y(value)}`)
                  .join(" ")}
              />
            ))}
      </svg>
      <div className="plugin-chart-legend">
        {chart.series.map((series, index) => (
          <span key={index}>
            <i style={{ background: COLORS[index % COLORS.length] }} />
            {series.name}
          </span>
        ))}
      </div>
    </figure>
  );
}