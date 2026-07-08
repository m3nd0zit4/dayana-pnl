import type { ContactSource } from "@prisma/client";
import { generateObject } from "ai";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { z } from "zod";
import { COUNTRY_OPTIONS, getCountryByIso } from "../countries";
import { normalizePhone } from "../phone";
import { getGeminiModel } from "./gemini";

const CONTACT_SOURCES = [
  "WEB",
  "WHATSAPP_DIRECT",
  "TIKTOK",
  "INSTAGRAM",
  "YOUTUBE",
  "REFERRAL",
  "OTHER",
] as const;

const extractionSchema = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z
    .string()
    .nullable()
    .describe("Número tal como aparece en el texto, con o sin prefijo +"),
  countryIso: z
    .string()
    .nullable()
    .describe("Código ISO-2 del país (ej. CO, MX, ES) si es deducible"),
  countryName: z
    .string()
    .nullable()
    .describe("Nombre del país si se menciona y no conoces el ISO"),
  preferredLocale: z.enum(["es", "en"]).nullable(),
  source: z.enum(CONTACT_SOURCES).nullable(),
  sourceDetail: z.string().nullable(),
  notes: z
    .string()
    .nullable()
    .describe("Resumen breve en español (máx 300 caracteres) del motivo o contexto"),
});

const SYSTEM_PROMPT = `Eres el asistente del CRM de una consulta de terapia y PNL.
Extrae los datos de contacto del texto que te pasan (suele ser una conversación
de WhatsApp o un mensaje libre, casi siempre en español). Reglas:
- Devuelve null en todo campo que no aparezca en el texto. NUNCA inventes datos.
- firstName/lastName: los de la persona interesada, no los del terapeuta.
- phone: cópialo tal cual aparezca (con o sin prefijo internacional).
- countryIso: solo si es explícito o deducible del prefijo telefónico (+57 → CO).
- preferredLocale: "es" o "en" según el idioma en que escribe la persona.
- source: solo si el texto indica el canal de origen.
- notes: resumen útil y breve para el historial (motivo de consulta, contexto).`;

export type ExtractedContactFields = {
  firstName?: string;
  lastName?: string;
  email?: string;
  /** Móvil local en dígitos (sin prefijo), como lo espera el formulario. */
  phone?: string;
  countryIso?: string;
  preferredLocale?: string;
  source?: ContactSource;
  sourceDetail?: string;
  notes?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const findCountryIsoByName = (name: string): string | null => {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const hit = COUNTRY_OPTIONS.find((c) => c.name.toLowerCase() === needle);
  return hit?.iso2 ?? null;
};

/**
 * Llama a Gemini y post-procesa con los helpers deterministas del repo:
 * el teléfono se normaliza con libphonenumber (jamás se confía en la IA para
 * E.164) y el país se valida contra la lista real de ISO-2.
 */
export const extractContactFields = async (
  text: string
): Promise<ExtractedContactFields> => {
  const { object } = await generateObject({
    model: getGeminiModel(),
    schema: extractionSchema,
    system: SYSTEM_PROMPT,
    prompt: text,
  });

  const result: ExtractedContactFields = {};

  let countryIso = object.countryIso?.trim().toUpperCase() || null;
  if (countryIso && !getCountryByIso(countryIso)) countryIso = null;
  if (!countryIso && object.countryName) {
    countryIso = findCountryIsoByName(object.countryName);
  }

  if (object.phone) {
    const normalized = normalizePhone(
      object.phone,
      (countryIso ?? "CO") as CountryCode
    );
    if (normalized) {
      const parsed = parsePhoneNumberFromString(normalized.phoneE164);
      if (parsed) {
        result.phone = String(parsed.nationalNumber);
        // Prefijo internacional explícito en el texto gana sobre lo que diga la IA.
        if (object.phone.includes("+") && parsed.country) {
          countryIso = parsed.country;
        } else if (!countryIso) {
          countryIso = normalized.phoneCountryIso;
        }
      }
    }
  }

  if (countryIso) result.countryIso = countryIso;

  const firstName = object.firstName?.trim();
  if (firstName) result.firstName = firstName.slice(0, 120);
  const lastName = object.lastName?.trim();
  if (lastName) result.lastName = lastName.slice(0, 120);

  const email = object.email?.trim().toLowerCase();
  if (email && EMAIL_RE.test(email)) result.email = email.slice(0, 200);

  if (object.preferredLocale) result.preferredLocale = object.preferredLocale;
  if (object.source) result.source = object.source as ContactSource;

  const sourceDetail = object.sourceDetail?.trim();
  if (sourceDetail) result.sourceDetail = sourceDetail.slice(0, 200);
  const notes = object.notes?.trim();
  if (notes) result.notes = notes.slice(0, 2000);

  return result;
};
