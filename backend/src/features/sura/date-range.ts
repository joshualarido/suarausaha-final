export type SuraDatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "this_year"
  | "last_7_days"
  | "last_30_days";

export interface SuraDateRangeInput {
  preset: SuraDatePreset | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface ResolvedSuraDateRange {
  label: string;
  startDate: string;
  endDate: string;
}

const PRESET_LABELS: Record<SuraDatePreset, string> = {
  today: "hari ini",
  yesterday: "kemarin",
  this_week: "minggu ini",
  this_month: "bulan ini",
  this_year: "tahun ini",
  last_7_days: "7 hari terakhir",
  last_30_days: "30 hari terakhir",
};

function jakartaDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateFromParts(parts: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function mondayStart(date: Date): Date {
  const day = date.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  return addDays(date, -daysSinceMonday);
}

export function resolveSuraDateRange(input: SuraDateRangeInput, now = new Date()): ResolvedSuraDateRange {
  const preset = input.preset ?? "today";
  const today = dateFromParts(jakartaDateParts(now));

  if (input.startDate && input.endDate) {
    return {
      label: PRESET_LABELS[preset],
      startDate: input.startDate,
      endDate: input.endDate,
    };
  }

  if (preset === "yesterday") {
    const yesterday = addDays(today, -1);
    return {
      label: PRESET_LABELS[preset],
      startDate: toIsoDate(yesterday),
      endDate: toIsoDate(yesterday),
    };
  }

  if (preset === "this_week") {
    return {
      label: PRESET_LABELS[preset],
      startDate: toIsoDate(mondayStart(today)),
      endDate: toIsoDate(today),
    };
  }

  if (preset === "this_month") {
    return {
      label: PRESET_LABELS[preset],
      startDate: toIsoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
      endDate: toIsoDate(today),
    };
  }

  if (preset === "this_year") {
    return {
      label: PRESET_LABELS[preset],
      startDate: toIsoDate(new Date(Date.UTC(today.getUTCFullYear(), 0, 1))),
      endDate: toIsoDate(today),
    };
  }

  if (preset === "last_7_days") {
    return {
      label: PRESET_LABELS[preset],
      startDate: toIsoDate(addDays(today, -6)),
      endDate: toIsoDate(today),
    };
  }

  if (preset === "last_30_days") {
    return {
      label: PRESET_LABELS[preset],
      startDate: toIsoDate(addDays(today, -29)),
      endDate: toIsoDate(today),
    };
  }

  return {
    label: PRESET_LABELS.today,
    startDate: toIsoDate(today),
    endDate: toIsoDate(today),
  };
}
