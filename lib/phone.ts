import {
  AsYouType,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type NormalizedPhone = {
  phoneE164: string;
  phoneCountryIso: string;
};

const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u00A0]/g;
const LOCAL_PHONE_MAX_DIGITS = 15;

const LOCAL_PLACEHOLDERS: Partial<Record<CountryCode, string>> = {
  CO: "300 123 4567",
  ES: "612 345 678",
  MX: "55 1234 5678",
  US: "555 123 4567",
  AR: "11 2345 6789",
  CL: "9 1234 5678",
};

export const getLocalPhonePlaceholder = (countryIso: CountryCode): string =>
  LOCAL_PLACEHOLDERS[countryIso] ?? "300 123 4567";

/** Limpia entrada humana: espacios, guiones, 00…, caracteres invisibles de WhatsApp. */
export const sanitizePhoneInput = (raw: string): string => {
  const s = raw.replace(INVISIBLE_CHARS, "").trim();
  if (!s) return "";

  const stripped = s.replace(/[\s().\-\u2010-\u2015]/g, "");
  if (/^00\d/.test(stripped)) {
    return `+${stripped.slice(2)}`;
  }

  const digitsOnly = s.replace(/[^\d+]/g, "");
  if (digitsOnly.startsWith("+")) {
    return `+${digitsOnly.slice(1).replace(/\D/g, "")}`;
  }
  return digitsOnly.replace(/\D/g, "");
};

/**
 * Campo de móvil local: solo dígitos, sin + ni prefijo del país
 * (el prefijo va en el selector de País).
 */
export const sanitizeLocalPhoneInput = (
  raw: string,
  countryIso: CountryCode
): string => {
  let digits = raw.replace(INVISIBLE_CHARS, "").replace(/\D/g, "");
  if (!digits) return "";

  try {
    const callingCode = getCountryCallingCode(countryIso);
    if (
      digits.startsWith(callingCode) &&
      digits.length > callingCode.length + 5
    ) {
      digits = digits.slice(callingCode.length);
    }
  } catch {
    /* país sin prefijo en libphonenumber */
  }

  digits = digits.replace(/^0+/, "");
  return digits.slice(0, LOCAL_PHONE_MAX_DIGITS);
};

export const formatLocalPhoneDisplay = (
  raw: string,
  countryIso: CountryCode
): string => {
  const digits = sanitizeLocalPhoneInput(raw, countryIso);
  if (!digits) return "";
  return new AsYouType(countryIso).input(digits);
};

const tryParse = (candidate: string, defaultCountry: CountryCode) => {
  if (!candidate || candidate === "+") return null;
  const parsed = candidate.startsWith("+")
    ? parsePhoneNumberFromString(candidate)
    : parsePhoneNumberFromString(candidate, defaultCountry);
  return parsed?.isValid() ? parsed : null;
};

export const normalizePhone = (
  raw: string,
  defaultCountry: CountryCode = "CO"
): NormalizedPhone | null => {
  const compact = sanitizePhoneInput(raw);
  if (!compact) return null;

  const candidates: string[] = [];

  if (compact.startsWith("+")) {
    candidates.push(compact);
  } else {
    candidates.push(compact);
    const withoutTrunk = compact.replace(/^0+/, "");
    if (withoutTrunk !== compact) candidates.push(withoutTrunk);
    if (compact.length >= 10) candidates.push(`+${compact}`);
    if (withoutTrunk !== compact && withoutTrunk.length >= 9) {
      candidates.push(`+${withoutTrunk}`);
    }
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const parsed = tryParse(candidate, defaultCountry);
    if (parsed) {
      return {
        phoneE164: parsed.format("E.164"),
        phoneCountryIso: parsed.country ?? defaultCountry,
      };
    }
  }

  return null;
};

/** Normaliza usando el país del formulario; el input es móvil local (sin +). */
export const normalizePhoneWithCountry = (
  localRaw: string,
  countryIso: CountryCode
): NormalizedPhone | null => {
  const local = sanitizeLocalPhoneInput(localRaw, countryIso);
  if (!local) return null;

  const asNational = normalizePhone(local, countryIso);
  if (asNational) {
    return {
      phoneE164: asNational.phoneE164,
      phoneCountryIso: countryIso,
    };
  }

  // Respaldo si pegaron número internacional completo
  return normalizePhone(localRaw, countryIso);
};

export type LocalPhoneValidation = {
  normalized: NormalizedPhone | null;
  hint: string | null;
};

export const validateLocalPhone = (
  localRaw: string,
  countryIso: CountryCode
): LocalPhoneValidation => {
  const local = sanitizeLocalPhoneInput(localRaw, countryIso);
  if (!local) return { normalized: null, hint: null };

  const normalized = normalizePhoneWithCountry(local, countryIso);
  if (normalized) return { normalized, hint: null };

  const parsed = parsePhoneNumberFromString(local, countryIso);
  const placeholder = getLocalPhonePlaceholder(countryIso);

  if (parsed && !parsed.isPossible()) {
    return {
      normalized: null,
      hint: `Número no válido. Ejemplo: ${placeholder}`,
    };
  }

  if (local.length < 8) {
    return {
      normalized: null,
      hint: "Solo el móvil local, sin prefijo (ya está en País).",
    };
  }

  return {
    normalized: null,
    hint: `Revisa el número; parece incompleto. Ejemplo: ${placeholder}`,
  };
};
