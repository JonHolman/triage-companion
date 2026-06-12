/**
 * Shared formatting utilities for terminal output.
 */

const SEVERITY_COLORS = {
  critical: "\x1b[31m",   // red
  high: "\x1b[91m",       // bright red
  medium: "\x1b[33m",     // yellow
  low: "\x1b[36m",        // cyan
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export function bold(text) {
  return `${BOLD}${text}${RESET}`;
}

export function dim(text) {
  return `${DIM}${text}${RESET}`;
}

export function severityColor(severity, text) {
  const color = SEVERITY_COLORS[severity?.toLowerCase()] || "";
  return color ? `${color}${text}${RESET}` : text;
}

export function table(rows, { headers = [], indent = 0 } = {}) {
  if (rows.length === 0 && headers.length === 0) return "";

  const allRows = headers.length > 0 ? [headers, ...rows] : rows;
  const colCount = Math.max(...allRows.map((r) => r.length));
  const widths = Array.from({ length: colCount }, () => 0);

  for (const row of allRows) {
    for (let i = 0; i < row.length; i++) {
      const len = stripAnsi(String(row[i] ?? "")).length;
      if (len > widths[i]) widths[i] = len;
    }
  }

  const prefix = " ".repeat(indent);
  const lines = [];

  for (let r = 0; r < allRows.length; r++) {
    const row = allRows[r];
    const cells = row.map((cell, i) => {
      const s = String(cell ?? "");
      const pad = widths[i] - stripAnsi(s).length;
      return s + " ".repeat(Math.max(pad, 0));
    });
    lines.push(prefix + cells.join("  "));

    if (r === 0 && headers.length > 0) {
      lines.push(prefix + widths.map((w) => "─".repeat(w)).join("──"));
    }
  }

  return lines.join("\n");
}

export function truncate(text, maxLen) {
  if (!text) return "";
  const clean = text.replace(/[\r\n]+/g, " ");
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + "…";
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function relativeTime(date) {
  if (!date) return "";
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function formatDate(date) {
  if (!date) return "";
  return date.toLocaleString();
}
