export const pad2 = (n: number) => String(n).padStart(2, "0");

export const parseDateTimeLocal = (value: string) => {
  if (!value?.includes("T")) return null;
  const [datePart, timePart] = value.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  return { date: new Date(y, mo - 1, d), hour: h, minute: mi };
};

export const toDateTimeLocal = (date: Date, hour: number, minute: number) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(hour)}:${pad2(minute)}`;

export const formatDateTimeLocalEs = (value: string) => {
  const parsed = parseDateTimeLocal(value);
  if (!parsed) return "";
  const dateStr = parsed.date.toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${dateStr} · ${pad2(parsed.hour)}:${pad2(parsed.minute)}`;
};

/** Formato compacto para el campo cerrado: 09/06/2026, 10:00 */
export const formatDateTimeShortEs = (value: string) => {
  const parsed = parseDateTimeLocal(value);
  if (!parsed) return "";
  const d = parsed.date;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}, ${pad2(parsed.hour)}:${pad2(parsed.minute)}`;
};

export const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5);
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
