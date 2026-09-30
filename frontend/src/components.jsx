import React from "react";

export function Card({ title, subtitle, action, children, className = "card" }) {
  return (
    <article className={className}>
      {(title || subtitle || action) && (
        <header className="ui-card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p className="sub">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </article>
  );
}

export function DataTable({ headers, rows, onRow, empty = "No data", className = "" }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className={`scroll ${className}`.trim()}>
      <table>
        <thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              className={`${onRow ? "click " : ""}${row.className || ""}`.trim()}
              key={row.key || rowIndex}
              onClick={onRow ? () => onRow(rowIndex) : undefined}
              onKeyDown={onRow ? (event) => event.key === "Enter" && onRow(rowIndex) : undefined}
              tabIndex={onRow ? 0 : undefined}
            >
              {row.cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Badge({ children, tone = "" }) {
  return <span className={`pill ${tone}`.trim()}>{children}</span>;
}

export function Notice({ children, tone = "bad" }) {
  return <div className={`report ${tone}`}>{children}</div>;
}

export function Loading({ children = "Loading…" }) {
  return <div className="empty" role="status">{children}</div>;
}

export function PageError({ error, onRetry }) {
  if (!error) return null;
  return (
    <Notice>
      <strong>{error.message || String(error)}</strong>
      {onRetry && <button className="secondary" type="button" onClick={onRetry}>Try again</button>}
    </Notice>
  );
}

export function MetricGrid({ items }) {
  return (
    <div className="ov-kpis">
      {items.map((item) => {
        const { label, value, note, delta, target, progress } = Array.isArray(item) ? { label: item[0], value: item[1], note: item[2] } : item;
        return <article className="kpi-card" key={label}>
          <div className="kpi-body">
            <div className="k-label">{label}</div>
            <div className="k-value">{value}</div>
            {delta !== undefined ? <div className="k-delta-row"><Delta mv={delta} /><span className="k-note">{note}</span></div> : note && <div className="k-note">{note}</div>}
            {target != null && <div className="k-target"><span className="k-target-track"><span style={{ width: `${Math.max(0, Math.min(100, progress ?? 0))}%` }} /></span><span>Target {target}</span></div>}
          </div>
        </article>;
      })}
    </div>
  );
}

export function Drawer({ title, onClose, children }) {
  return (
    <>
      <button className="drawer-scrim" type="button" aria-label="Close details" onClick={onClose} />
      <aside className="drawer" aria-label={title} aria-live="polite">
        <button className="close" type="button" aria-label="Close" onClick={onClose}>×</button>
        <h2>{title}</h2>
        {children}
      </aside>
    </>
  );
}
// ---------------------------------------------------------------------------
// Visual building blocks added for the Workflow 2 UI pass
// ---------------------------------------------------------------------------
/** Relative movement with direction-aware colour (Average Position: lower is better). */
export function Delta({ mv, suffix = "", invert = false }) {
  if (!mv) return <span className="delta flat">–</span>;
  const better = invert ? !mv.better : mv.better;
  const tone = better == null ? "flat" : better ? "good" : "bad";
  const arrow = mv.relative_pct > 0 ? "▲" : mv.relative_pct < 0 ? "▼" : "•";
  return <span className={`delta ${tone}`}>{arrow} {Math.abs(mv.relative_pct).toFixed(1)}%{suffix}</span>;
}

/** Horizontal bars; `rows` = [{ label, value, highlight, marker, note }]. */
export function Bars({ rows, max = 100, format = (v) => v?.toFixed?.(1) ?? "–", markerLabel }) {
  const top = Math.max(max, ...rows.map((r) => Math.max(r.value || 0, r.marker || 0)));
  return <div className="bars" role="list">
    {rows.map((row) => <div className={`bar-row ${row.highlight ? "hl" : ""}`} role="listitem" key={row.label}>
      <span className="bar-label" title={row.label}>{row.label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${Math.max(0, (row.value || 0) / top * 100)}%` }} />
        {row.marker != null && <span className="bar-marker" style={{ left: `${row.marker / top * 100}%` }} title={`${markerLabel || "Reference"}: ${format(row.marker)}`} />}
      </span>
      <span className="bar-value">{format(row.value)}{row.note && <small>{row.note}</small>}</span>
    </div>)}
  </div>;
}

/** Intent × engine matrix, cells shaded by value (0–100). */
export function Heatmap({ rows, cols, value, title = (r, c, v) => `${r} · ${c}: ${v}`, format = (v) => v == null ? "–" : v.toFixed(0) }) {
  return <div className="scroll"><table className="heatmap">
    <thead><tr><th />{cols.map((col) => <th key={col}>{col}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row}><th scope="row">{row}</th>{cols.map((col) => {
      const v = value(row, col);
      const level = v == null ? "na" : Math.min(7, Math.floor(v / 12.5));
      return <td key={col} className={`hm hm-${level}`} title={title(row, col, format(v))}>{format(v)}</td>;
    })}</tr>)}</tbody>
  </table></div>;
}

/** Segmented filter with counts. */
export function Segmented({ options, value, onChange, label }) {
  return <div className="segmented" role="tablist" aria-label={label}>
    {options.map(([key, text, count]) => <button type="button" role="tab" key={key || "all"} aria-selected={value === key} className={value === key ? "on" : ""} onClick={() => onChange(key)}>
      {text}{count != null && <span className="count">{count}</span>}
    </button>)}
  </div>;
}
