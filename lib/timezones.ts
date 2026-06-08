import { getTimeZones } from "@vvo/tzdb";
import { COMMON_TIMEZONES } from "@/app/config/contact-form";
import type { SelectOption } from "@/lib/crm/select-option";

const PRIORITY = new Set(COMMON_TIMEZONES);

let cached: SelectOption[] | null = null;

const formatCity = (name: string) =>
  name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Zonas IANA con etiquetas legibles (datos @vvo/tzdb). */
export const getTimezoneSelectOptions = (): SelectOption[] => {
  if (cached) return cached;

  const zones = getTimeZones();

  const mapped = zones.map((tz) => {
    const city =
      tz.mainCities[0] != null
        ? formatCity(tz.mainCities[0])
        : formatCity(tz.name.split("/").pop() ?? tz.name);
    return {
      value: tz.name,
      label: `${city} · ${tz.countryName}`,
      hint: `UTC${tz.currentTimeFormat}`,
      group: tz.continentName,
      isPriority: PRIORITY.has(tz.name),
    };
  });

  mapped.sort((a, b) => {
    if (a.isPriority && !b.isPriority) return -1;
    if (!a.isPriority && b.isPriority) return 1;
    return a.label.localeCompare(b.label, "es");
  });

  cached = mapped.map(({ isPriority: _p, ...opt }) => opt);
  return cached;
};

export const TIMEZONE_PRIORITY_COUNT = COMMON_TIMEZONES.length;
