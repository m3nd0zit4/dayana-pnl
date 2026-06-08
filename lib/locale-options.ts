import type { SelectOption } from "@/lib/crm/select-option";

const LOCALE_CODES = [
  "es",
  "en",
  "pt",
  "fr",
  "de",
  "it",
  "ca",
  "nl",
  "pl",
  "ru",
  "zh",
  "ja",
  "ko",
  "ar",
] as const;

const displayNames =
  typeof Intl !== "undefined"
    ? new Intl.DisplayNames(["es"], { type: "language" })
    : null;

/** Idiomas para contacto (Intl.DisplayNames en español). */
export const getLocaleSelectOptions = (): SelectOption[] =>
  LOCALE_CODES.map((code) => ({
    value: code,
    label: displayNames?.of(code) ?? code,
    hint: code.toUpperCase(),
  }));
