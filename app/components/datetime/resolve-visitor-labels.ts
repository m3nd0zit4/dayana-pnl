/**
 * Resolve the visitor display timezone.
 * 1) Server geo (`userCountry`) via `@vvo/tzdb` — preferred on Vercel.
 * 2) If missing (local/dev), optional IP lookup from the browser so a VPN
 *    exit IP is visible (server-side lookups would see the datacenter IP).
 */

import {
  formatLocalClockTime,
  formatLocalDateTimeMedium,
  formatLocalLongDate,
  getSchedulePlaceLabel,
  getVisitorTimeZone,
  resolveVisitorDisplayTimeZone,
} from "@/lib/datetime/visitor-schedule";

export type VisitorScheduleLabels = {
  date: string;
  time: string;
  dateTime: string;
  place: string;
  timeZone: string;
};

type IpWhoResponse = {
  success?: boolean;
  country_code?: string;
  timezone?: { id?: string } | string;
};

const IP_WHO_URL = "https://ipwho.is/";

const readIpWhoTimeZone = (data: IpWhoResponse): string | null => {
  if (!data.success) return null;
  if (typeof data.timezone === "string" && data.timezone.trim()) {
    return data.timezone.trim();
  }
  if (
    data.timezone &&
    typeof data.timezone === "object" &&
    typeof data.timezone.id === "string" &&
    data.timezone.id.trim()
  ) {
    return data.timezone.id.trim();
  }
  return null;
};

/**
 * When the server did not pass a country (no Vercel/CDN header), ask a public
 * IP→geo endpoint from the browser so VPN exit nodes are detected.
 */
export const detectCountryFromVisitorIp = async (
  signal?: AbortSignal
): Promise<{ country: string; timeZone: string | null } | null> => {
  try {
    const res = await fetch(IP_WHO_URL, {
      signal,
      credentials: "omit",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as IpWhoResponse;
    const country = data.country_code?.trim().toUpperCase();
    if (!country || country === "XX") return null;
    return {
      country,
      timeZone: readIpWhoTimeZone(data),
    };
  } catch {
    return null;
  }
};

export const buildVisitorScheduleLabels = (
  startsAtIso: string,
  timeZone: string,
  countryIso?: string | null
): VisitorScheduleLabels => ({
  date: formatLocalLongDate(startsAtIso, timeZone),
  time: formatLocalClockTime(startsAtIso, timeZone),
  dateTime: formatLocalDateTimeMedium(startsAtIso, timeZone),
  place: getSchedulePlaceLabel(timeZone, countryIso),
  timeZone,
});

/**
 * Resolve IANA zone for public schedule chips.
 * Prefers server geo; otherwise IP geo; otherwise browser.
 */
export const resolveLabelsForVisitor = async (
  startsAtIso: string,
  userCountry?: string | null,
  signal?: AbortSignal
): Promise<VisitorScheduleLabels> => {
  if (userCountry?.trim()) {
    const timeZone = resolveVisitorDisplayTimeZone(userCountry);
    return buildVisitorScheduleLabels(startsAtIso, timeZone, userCountry);
  }

  const detected = await detectCountryFromVisitorIp(signal);
  if (detected) {
    const timeZone =
      detected.timeZone &&
      (() => {
        try {
          Intl.DateTimeFormat("en-US", {
            timeZone: detected.timeZone!,
          }).format(new Date());
          return detected.timeZone;
        } catch {
          return null;
        }
      })();
    const zone =
      timeZone ?? resolveVisitorDisplayTimeZone(detected.country);
    return buildVisitorScheduleLabels(startsAtIso, zone, detected.country);
  }

  const timeZone = getVisitorTimeZone();
  return buildVisitorScheduleLabels(startsAtIso, timeZone, null);
};
