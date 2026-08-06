import { getSiteSetting, setSiteSetting } from "@/lib/crm/site-settings";

export {
  DEFAULT_OPERATIONAL_TZ,
  OPERATIONAL_TZ,
  isValidIanaTimeZone,
  getDateKeyInTz,
  getTimeHmInTz,
  zonedDateTimeToUtc,
  getStartOfDayInTz,
  getStartOfNextDayInTz,
  normalizeTimeHm,
} from "@/lib/datetime/zoned-time";

import {
  DEFAULT_OPERATIONAL_TZ,
  isValidIanaTimeZone,
} from "@/lib/datetime/zoned-time";

export const OPERATIONAL_TIMEZONE_SETTING_KEY = "operational_timezone";

/** Zona horaria operativa del CRM (SiteSetting → Bogotá). */
export const getOperationalTimezone = async (): Promise<string> => {
  try {
    const raw = await getSiteSetting(OPERATIONAL_TIMEZONE_SETTING_KEY);
    if (raw && isValidIanaTimeZone(raw.trim())) return raw.trim();
  } catch {
    /* DB unavailable */
  }
  return DEFAULT_OPERATIONAL_TZ;
};

export const setOperationalTimezone = async (tz: string): Promise<void> => {
  const next = tz.trim();
  if (!isValidIanaTimeZone(next)) throw new Error("INVALID_TIMEZONE");
  await setSiteSetting(OPERATIONAL_TIMEZONE_SETTING_KEY, next);
};
