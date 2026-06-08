import { getCountries, getCountryCallingCode } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

export type CountryOption = {
  iso2: CountryCode;
  name: string;
  dialCode: string;
};

const displayNames =
  typeof Intl !== "undefined"
    ? new Intl.DisplayNames(["es"], { type: "region" })
    : null;

const buildOptions = (): CountryOption[] => {
  const options: CountryOption[] = [];
  for (const iso2 of getCountries()) {
    try {
      const name = displayNames?.of(iso2) ?? iso2;
      const dialCode = `+${getCountryCallingCode(iso2)}`;
      options.push({ iso2, name, dialCode });
    } catch {
      /* país sin prefijo en libphonenumber */
    }
  }
  return options.sort((a, b) => a.name.localeCompare(b.name, "es"));
};

/** Lista completa de países (español + prefijo telefónico). */
export const COUNTRY_OPTIONS: CountryOption[] = buildOptions();

const PRIORITY_ISO: CountryCode[] = [
  "CO",
  "MX",
  "US",
  "ES",
  "AR",
  "CL",
  "PE",
  "EC",
  "VE",
  "PA",
  "CR",
  "GT",
  "DO",
  "PR",
  "GB",
  "DE",
  "FR",
  "IT",
  "CA",
  "BR",
];

export const PRIORITY_COUNTRY_COUNT = PRIORITY_ISO.length;

export const COUNTRY_OPTIONS_GROUPED = (): CountryOption[] => {
  const byIso = new Map(COUNTRY_OPTIONS.map((c) => [c.iso2, c]));
  const priority = PRIORITY_ISO.map((iso) => byIso.get(iso)).filter(
    (c): c is CountryOption => !!c
  );
  const rest = COUNTRY_OPTIONS.filter((c) => !PRIORITY_ISO.includes(c.iso2));
  return [...priority, ...rest];
};

export const getCountryByIso = (iso2: string): CountryOption | undefined =>
  COUNTRY_OPTIONS.find((c) => c.iso2 === iso2);

export const formatCountryLabel = (iso2: string): string => {
  const c = getCountryByIso(iso2);
  return c ? `${c.name} (${c.dialCode})` : iso2;
};

export { suggestTimezoneForCountry } from "./contact-timezone";
