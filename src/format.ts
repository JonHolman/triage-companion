import { normalizedKnownSeverity } from "./severity.ts";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "\x1b[31m",
  high: "\x1b[91m",
  medium: "\x1b[33m",
  low: "\x1b[36m",
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export type TableCell = string | number | null | undefined;

export interface TableOptions {
  headers?: ReadonlyArray<TableCell>;
  indent?: number;
}

export interface ResponsiveTableOptions extends TableOptions {
  width?: number;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function measureTable(
  rows: ReadonlyArray<ReadonlyArray<TableCell>>,
  headers: ReadonlyArray<TableCell>,
): { widths: number[]; totalWidth: number } {
  const allRows = headers.length > 0 ? [headers, ...rows] : rows;
  const columns = Math.max(...allRows.map((row) => row.length));
  const widths = Array.from({ length: columns }, () => 0);

  for (const row of allRows) {
    for (let i = 0; i < row.length; i++) {
      const width = stripAnsi(String(row[i] ?? "")).length;
      if (width > (widths[i] ?? 0)) {
        widths[i] = width;
      }
    }
  }

  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(columns - 1, 0) * 2;
  return { widths, totalWidth };
}

function renderStackedTable(
  rows: ReadonlyArray<ReadonlyArray<TableCell>>,
  headers: ReadonlyArray<TableCell>,
  indent: number,
): string {
  const prefix = " ".repeat(Math.max(indent, 0));
  const lines: string[] = [];

  for (const [rowIndex, row] of rows.entries()) {
    if (rowIndex > 0) {
      lines.push("");
    }

    const columnCount = Math.max(headers.length, row.length);
    for (let i = 0; i < columnCount; i++) {
      const label = String(headers[i] ?? `Field ${i + 1}`);
      const value = String(row[i] ?? "");
      lines.push(`${prefix}${label}: ${value}`);
    }
  }

  return lines.join("\n");
}

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export function severityColor(severity: string, text: string): string {
  const key = normalizedKnownSeverity(severity);
  const color = key ? SEVERITY_COLORS[key] ?? "" : "";
  return color ? `${color}${text}${RESET}` : text;
}

export function table(rows: ReadonlyArray<ReadonlyArray<TableCell>>, { headers = [], indent = 0 }: TableOptions = {}): string {
  if (rows.length === 0 && headers.length === 0) {
    return "";
  }

  const { widths } = measureTable(rows, headers);

  const prefix = " ".repeat(Math.max(indent, 0));
  const lines: string[] = [];
  const allRows = headers.length > 0 ? [headers, ...rows] : rows;

  for (const [r, row] of allRows.entries()) {
    const cells = widths.map((width, index) => {
      const value = String(row[index] ?? "");
      const padding = width - stripAnsi(value).length;
      return value + " ".repeat(Math.max(padding, 0));
    });

    lines.push(prefix + cells.join("  "));

    if (r === 0 && headers.length > 0) {
      lines.push(prefix + widths.map((width) => "─".repeat(width)).join("──"));
    }
  }

  return lines.join("\n");
}

export function responsiveTable(
  rows: ReadonlyArray<ReadonlyArray<TableCell>>,
  { headers = [], indent = 0, width = process.stdout.columns }: ResponsiveTableOptions = {},
): string {
  if (rows.length === 0 && headers.length === 0) {
    return "";
  }

  const { totalWidth } = measureTable(rows, headers);
  const renderedWidth = totalWidth + Math.max(indent, 0);
  if (width && width > 0 && renderedWidth > width) {
    return renderStackedTable(rows, headers, indent);
  }

  return table(rows, { headers, indent });
}

export function relativeTime(date?: Date | null): string {
  if (!date) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return date.toLocaleDateString();
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  return date.toLocaleDateString();
}
