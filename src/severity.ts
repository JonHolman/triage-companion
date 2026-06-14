export const KNOWN_SEVERITIES = ["critical", "high", "medium", "low"] as const;

const SEVERITY_RANKS: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function normalizedKnownSeverity(value: string): string | null {
  const key = value.trim().toLowerCase();
  return Object.hasOwn(SEVERITY_RANKS, key) ? key : null;
}

export function severityRank(value: string): number {
  const key = normalizedKnownSeverity(value);
  return key ? SEVERITY_RANKS[key] ?? 0 : 0;
}

export function summarizeSeverities(values: readonly string[]): string {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const value of values) {
    const key = normalizedKnownSeverity(value);
    if (key) {
      counts[key] += 1;
    }
  }

  return KNOWN_SEVERITIES
    .map((level) => [level, counts[level] ?? 0] as const)
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `${count} ${level}`)
    .join(", ");
}
