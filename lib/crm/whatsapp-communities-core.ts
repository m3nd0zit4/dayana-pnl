/**
 * Partes puras de las comunidades de WhatsApp (sin base de datos): estados de
 * los miembros, conteos y la lectura de números pegados desde la info del
 * grupo en el celular. Se usan en el servidor y en la pantalla.
 */

export const MEMBER_STATUSES = ["INVITED", "JOINED", "LEFT", "DECLINED"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const COMMUNITY_KINDS = ["community", "group"] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  INVITED: "Invitada",
  JOINED: "Está",
  LEFT: "Salió",
  DECLINED: "No quiso",
};

export type StatusCounts = Record<MemberStatus, number>;

export const emptyCounts = (): StatusCounts => ({ INVITED: 0, JOINED: 0, LEFT: 0, DECLINED: 0 });

export const isMemberStatus = (s: string): s is MemberStatus => (MEMBER_STATUSES as readonly string[]).includes(s);

/** Suma por estado. Cada fila cuenta 1, o `count` si viene de un groupBy. */
export const countByStatus = (rows: { status: string; count?: number }[]): StatusCounts => {
  const out = emptyCounts();
  for (const r of rows) if (isMemberStatus(r.status)) out[r.status] += r.count ?? 1;
  return out;
};

// Marcas invisibles de dirección que WhatsApp mete al copiar números.
const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;

/**
 * Un número en dígitos, con indicativo. `00` internacional se quita y un
 * celular colombiano de 10 dígitos (3xx…) sin indicativo recibe el 57.
 * Devuelve null si no parece un número de WhatsApp (8 a 15 dígitos).
 */
export const normalizePhoneDigits = (raw: string): string | null => {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("3")) d = `57${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
};

/**
 * Las formas en que el mismo número puede estar guardado. México: 521… y 52…
 * (el 1 de celular que WhatsApp a veces pone y a veces no). Argentina: 549… y
 * 54… (el 9 de celular).
 */
export const phoneVariants = (digits: string): string[] => {
  const out = new Set([digits]);
  if (digits.startsWith("521") && digits.length === 13) out.add(`52${digits.slice(3)}`);
  if (digits.startsWith("52") && !digits.startsWith("521") && digits.length === 12) out.add(`521${digits.slice(2)}`);
  if (digits.startsWith("549") && digits.length === 13) out.add(`54${digits.slice(3)}`);
  if (digits.startsWith("54") && !digits.startsWith("549") && digits.length === 12) out.add(`549${digits.slice(2)}`);
  return [...out];
};

export type ParsedPhone = { raw: string; digits: string; variants: string[] };

/**
 * Saca los números de un texto pegado (lista de la info del grupo, un chat,
 * una hoja de cálculo…), en cualquier formato: «+52 1 55 1234 5678»,
 * «(300) 123-4567», uno por renglón o separados por comas. Sin repetidos.
 */
export const parsePastedPhones = (text: string): ParsedPhone[] => {
  const seen = new Set<string>();
  const out: ParsedPhone[] = [];
  const chunks = text.replace(INVISIBLE, "").split(/[\n\r,;|]+/);
  for (const chunk of chunks) {
    for (const m of chunk.match(/\+?\d[\d\s().\- ]{5,}\d/g) ?? []) {
      const digits = normalizePhoneDigits(m);
      if (!digits || seen.has(digits)) continue;
      seen.add(digits);
      out.push({ raw: m.trim(), digits, variants: phoneVariants(digits) });
    }
  }
  return out;
};

/** Todos los phoneE164 a buscar en contactos. */
export const e164Candidates = (parsed: ParsedPhone[]): string[] => [
  ...new Set(parsed.flatMap((p) => p.variants.map((v) => `+${v}`))),
];

/**
 * Lo que va en {{mensaje}} de la plantilla de anuncio: el texto escrito sin
 * el saludo ni la «Novedad en …:» que la plantilla ya trae.
 */
export const announceMessage = (text: string, communityName: string): string => {
  let t = text.replace(/\{\{\s*nombre\s*\}\}/g, "").trim();
  t = t.replace(/^hola\s*,?\s*/i, "").replace(/^te bendigo\s*💛?\s*/i, "");
  const novedad = `novedad en ${communityName.toLowerCase()}`;
  if (t.toLowerCase().startsWith(novedad)) t = t.slice(novedad.length).replace(/^\s*:\s*/, "");
  return t.trim();
};

/** Empareja lo pegado con los contactos encontrados; lo que no está queda en `unknown`. */
export const matchPhonesToContacts = <C extends { id: string; phoneE164: string }>(
  parsed: ParsedPhone[],
  contacts: C[]
): { matched: { input: string; contact: C }[]; unknown: string[] } => {
  const byPhone = new Map(contacts.map((c) => [c.phoneE164.replace(/\D/g, ""), c]));
  const matched: { input: string; contact: C }[] = [];
  const unknown: string[] = [];
  const taken = new Set<string>();
  for (const p of parsed) {
    const contact = p.variants.map((v) => byPhone.get(v)).find(Boolean);
    if (!contact) unknown.push(p.raw);
    else if (!taken.has(contact.id)) {
      taken.add(contact.id);
      matched.push({ input: p.raw, contact });
    }
  }
  return { matched, unknown };
};
