function parseDateInput(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsedDateOnly = new Date(`${trimmed}T00:00:00`);
      return Number.isNaN(parsedDateOnly.getTime()) ? null : parsedDateOnly;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function formatDateId(value, options = { day: "2-digit", month: "long", year: "numeric" }) {
  const parsedDate = parseDateInput(value);
  if (!parsedDate) return "-";

  return new Intl.DateTimeFormat("id-ID", options).format(parsedDate);
}

export function formatDateTimeId(
  value,
  options = { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
) {
  const parsedDate = parseDateInput(value);
  if (!parsedDate) return "-";

  return new Intl.DateTimeFormat("id-ID", options).format(parsedDate);
}
