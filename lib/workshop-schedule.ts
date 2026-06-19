import type { WorkshopScheduleSlot } from "./workshops";

const AMPM_RANGE =
  /^(\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.))\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.))$/i;

const amPmToTime24 = (value: string): string => {
  const match = value
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|p\.m\.)$/i);
  if (!match) return "";

  let hour = Number.parseInt(match[1]!, 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  const isPm = match[3]!.toLowerCase().startsWith("p");

  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const time24ToAmPm = (value: string): string => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value;

  const hour24 = Number.parseInt(match[1]!, 10);
  const minute = Number.parseInt(match[2]!, 10);
  const isPm = hour24 >= 12;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = isPm ? "p.m." : "a.m.";

  return minute === 0
    ? `${hour12} ${period}`
    : `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
};

export const formatScheduleSlotTime = (
  startTime: string,
  endTime: string
): string => {
  const start = time24ToAmPm(startTime);
  const end = time24ToAmPm(endTime);
  if (!start || !end) return "";
  return `${start} – ${end}`;
};

export const getScheduleSlotLabel = (slot: WorkshopScheduleSlot): string => {
  if (slot.startTime.trim() && slot.endTime.trim()) {
    return formatScheduleSlotTime(slot.startTime, slot.endTime);
  }
  return slot.time?.trim() ?? "";
};

const parseLegacyRange = (
  time: string
): Pick<WorkshopScheduleSlot, "startTime" | "endTime"> | null => {
  const match = time.trim().match(AMPM_RANGE);
  if (!match) return null;

  const startTime = amPmToTime24(match[1]!);
  const endTime = amPmToTime24(match[2]!);
  if (!startTime || !endTime) return null;

  return { startTime, endTime };
};

export const parseWorkshopSchedule = (value: unknown): WorkshopScheduleSlot[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("title" in item)) {
      return [];
    }

    const title = typeof item.title === "string" ? item.title : "";
    if (!title.trim()) return [];

    if (
      "startTime" in item &&
      "endTime" in item &&
      typeof item.startTime === "string" &&
      typeof item.endTime === "string"
    ) {
      return [
        {
          startTime: item.startTime,
          endTime: item.endTime,
          title,
          ...(typeof item.time === "string" ? { time: item.time } : {}),
        },
      ];
    }

    if ("time" in item && typeof item.time === "string") {
      const legacy = parseLegacyRange(item.time);
      return [
        {
          startTime: legacy?.startTime ?? "",
          endTime: legacy?.endTime ?? "",
          title,
          time: item.time,
        },
      ];
    }

    return [];
  });
};

export const normalizeWorkshopSchedule = (
  slots: WorkshopScheduleSlot[]
): WorkshopScheduleSlot[] =>
  slots
    .filter(
      (slot) =>
        slot.startTime.trim() &&
        slot.endTime.trim() &&
        slot.title.trim()
    )
    .map((slot) => ({
      startTime: slot.startTime.trim(),
      endTime: slot.endTime.trim(),
      title: slot.title.trim(),
      time: formatScheduleSlotTime(slot.startTime, slot.endTime),
    }));
