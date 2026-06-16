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
  return `${dateStr} · ${new Date(
    parsed.date.getFullYear(),
    parsed.date.getMonth(),
    parsed.date.getDate(),
    parsed.hour,
    parsed.minute
  ).toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })}`;
};

/** Formato compacto para el campo cerrado: 09/06/2026, 10:00 a. m. */
export const formatDateTimeShortEs = (value: string) => {
  const parsed = parseDateTimeLocal(value);
  if (!parsed) return "";
  const d = parsed.date;
  const timeStr = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    parsed.hour,
    parsed.minute
  ).toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}, ${timeStr}`;
};

export const to12Hour = (hour24: number) => ({
  hour12: hour24 % 12 || 12,
  period: (hour24 >= 12 ? "PM" : "AM") as "AM" | "PM",
});

export const to24Hour = (hour12: number, period: "AM" | "PM") => {
  if (period === "AM") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
};

/** Fecha y hora en español con AM/PM (zona horaria opcional). */
export const formatSessionDateTimeEs = (iso: string, timeZone?: string) => {
  const opts: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
  };
  if (timeZone) opts.timeZone = timeZone;
  return new Date(iso).toLocaleString("es-CO", opts);
};

export const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5);
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
export const HOUR_OPTIONS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
