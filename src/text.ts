export function inlineErrorText(text: string): string {
  const normalizedLineBreaks = text.replace(/\r\n?|\n/g, ", ");
  return normalizedLineBreaks.replace(/[\u0000-\u001F\u007F-\u009F]/g, (character) => {
    switch (character) {
      case "\t":
        return "\\t";
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateConfiguredText(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  if (value.trim() !== value) {
    throw new Error(`${label} must not include surrounding whitespace.`);
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error(`${label} must not include control characters.`);
  }

  return value;
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const second = Number.parseInt(match[6] ?? "", 10);
  const offset = match[7] ?? "";
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  if (offset !== "Z") {
    const offsetMatch = /^[+-](\d{2}):?(\d{2})$/.exec(offset);
    const offsetHour = Number.parseInt(offsetMatch?.[1] ?? "", 10);
    const offsetMinute = Number.parseInt(offsetMatch?.[2] ?? "", 10);
    if (offsetHour > 23 || offsetMinute > 59) {
      return null;
    }
  }

  const normalizedValue = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(normalizedValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
