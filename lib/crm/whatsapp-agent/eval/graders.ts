/**
 * Calificadores por código de una respuesta de la asistente (sin modelo,
 * repetibles): cada regla de Dayana es una prueba. Los usa
 * `scripts/whatsapp-agent-eval.ts` sobre lo que de verdad recibiría la
 * persona (después de `polishReply` y los bloques de pago), y sirven para
 * auditar respuestas reales.
 *
 * Cada regla salió de algo que pasó en producción (octubre de 2026): «querido»
 * a Fernando, «18:45» a Dayanna, el saludo duplicado a Yil, la ciudad y las
 * horas en el mismo mensaje, «quedamos agendadas»…
 */

import { personFirstName } from "@/lib/person-name";
import { foldForSearch } from "../../search-normalize";
import { mentionsPrice } from "../price-guard";
import { promiseBreach } from "../promise-guard";

export type GradeContext = {
  /** Lo que recibiría la persona. */
  reply: string;
  /** El chat ANTES de esta respuesta. */
  transcript: { direction: "INBOUND" | "OUTBOUND"; body: string | null; isAutoReply?: boolean }[];
  /** Herramientas que usó en esta vuelta, con su salida. */
  tools: { tool: string; output?: unknown }[];
  /** Los datos de pago que se adjuntaron tal cual (ahí sí hay números largos). */
  paymentBlocks?: string[];
  /**
   * Cómo habló la persona de sí («estoy cansada» → f; «soy desconfiado» → m).
   * «unknown»: no lo dijo, la asistente escribe sin género. Sin dato, no se mira.
   */
  gender?: "f" | "m" | "unknown";
  /** El nombre de su perfil de WhatsApp (puede no ser un nombre: «DIOS ES MI PROVEEDOR 🙏»). */
  profileName?: string | null;
  /** Horas que ya respaldan la respuesta (las que dio la agenda antes, las de su cita). */
  backing?: string[];
  /** Ya tiene una cita de verdad. */
  hasBooking?: boolean;
  /** Esa cita es hoy. */
  bookingToday?: boolean;
};

export type Grade = { id: string; pass: boolean; detail?: string };

const ENDEARMENTS =
  /\b(querid[oa]s?|cariño|mi amor|hermos[oa]|mi bell[oa]|lind[oa]|mi reina|mi rey|corazón|amig[oa]|mi vida|preciosa?|mamita|mi niña)\b/i;
const HEARTS = /[💛❤️💕💖💗💓💞💘💝🥰😘😍♥🫶]/u;
/** «18:45», «09:15» sin a. m./p. m. (las horas siempre con a. m./p. m.). */
const TWENTY_FOUR_HOUR = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b(?!\s*(?:a|p)\.?\s*m)/i;
/** La asistente no es Dayana: no llama, no atiende, no «queda agendada» con la persona. */
const AS_DAYANA =
  /\b(te llamo|yo te llamo|te llamaré|soy dayana|mi consulta|mis sesiones|mis terapias|quedamos (?:totalmente |entonces )?(?:agendad|confirmad)[oa]s|nos vemos (el|mañana|en la llamada))\b/i;
const GREETING = /^\s*(¡?hola\b|te bendigo\b|buen(os|as) (días|tardes|noches)\b)/i;
const ASKS_COUNTRY = /(desde|de) (qué|que) (país|ciudad)|(qué|que) ciudad|de d[oó]nde (me )?escribes/i;
const BOOKED_CLAIM = /\b(queda(s|n)? agendad|quedó agendad|está agendad|quedaste agendad|ya (te )?agend[ée]|cita (quedó )?confirmad|llamada (quedó )?confirmad)/i;
/**
 * Un adjetivo con género sobre la persona: «cuando estés lista», «quedaste
 * agendada», «estar pendiente y lista», «bienvenido». «Tu llamada quedó
 * agendada» no cuenta (habla de la llamada).
 */
const PERSON_GENDERED =
  /\b(?:quedaste|quedas|est[aá]s|est[eé]s|eres|seas|te sientes|te sientas|sentirte|estar|si[eé]ntete)\s+(?:muy\s+|m[aá]s\s+|bien\s+|pendiente y\s+)?(?:list|tranquil|preocupad|interesad|cansad|dispuest|segur|agendad|inscrit|motivad|emocionad|confundid|atent|content|ocupad|agradecid|encantad|preparad|decidid)([oa])s?\b|\bbienvenid([oa])s?\b/gi;
/** Una lista de horas («• jueves…», «- 9:30 a. m.»). */
const SLOT_LIST = /(^|\n)\s*[-•*]\s*\S.*\d{1,2}:\d{2}/m;

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?¿¡])\s+|\n+/)
    .map((s) => s.replace(/[¿?¡!.,]/g, "").trim().toLowerCase())
    .filter((s) => s.length >= 18);

const priorAi = (ctx: GradeContext) => ctx.transcript.filter((l) => l.direction === "OUTBOUND" && l.body?.trim());

const usedTool = (ctx: GradeContext, name: string, pred?: (output: Record<string, unknown>) => boolean) =>
  ctx.tools.some((t) => t.tool === name && (!pred || pred((t.output ?? {}) as Record<string, unknown>)));

/** El texto que escribió la asistente, sin los bloques de pago pegados tal cual. */
const ownText = (ctx: GradeContext) =>
  (ctx.paymentBlocks ?? []).reduce((text, block) => text.replace(block, ""), ctx.reply);

export const GRADERS: Record<string, (ctx: GradeContext) => Grade> = {
  sin_apodos: (ctx) => {
    const m = ownText(ctx).match(ENDEARMENTS);
    return { id: "sin_apodos", pass: !m, detail: m?.[0] };
  },
  sin_corazones: (ctx) => {
    const m = ownText(ctx).match(HEARTS);
    return { id: "sin_corazones", pass: !m, detail: m?.[0] };
  },
  horas_am_pm: (ctx) => {
    const m = ownText(ctx).match(TWENTY_FOUR_HOUR);
    return { id: "horas_am_pm", pass: !m, detail: m?.[0] };
  },
  sin_precios: (ctx) => ({ id: "sin_precios", pass: !mentionsPrice(ownText(ctx)) }),
  sin_numeros_de_cuenta: (ctx) => {
    // El modelo nunca escribe una cuenta: solo los bloques de Ajustes la llevan.
    const m = ownText(ctx).match(/\b\d[\d\s-]{8,}\d\b/);
    return { id: "sin_numeros_de_cuenta", pass: !m, detail: m?.[0] };
  },
  voz_de_asistente: (ctx) => {
    const m = ownText(ctx).match(AS_DAYANA);
    return { id: "voz_de_asistente", pass: !m, detail: m?.[0] };
  },
  sin_frases_repetidas: (ctx) => {
    const list = sentences(ownText(ctx));
    const dup = list.find((s, i) => list.indexOf(s) !== i);
    return { id: "sin_frases_repetidas", pass: !dup, detail: dup };
  },
  no_vuelve_a_saludar: (ctx) => {
    const greeted = priorAi(ctx).some((l) => GREETING.test(l.body ?? ""));
    const again = greeted && GREETING.test(ownText(ctx));
    return { id: "no_vuelve_a_saludar", pass: !again };
  },
  no_repite_pregunta_pais: (ctx) => {
    // Ya lo preguntó y la persona contestó después: no se vuelve a preguntar.
    const lines = ctx.transcript;
    const askedAt = lines.findIndex((l) => l.direction === "OUTBOUND" && ASKS_COUNTRY.test(l.body ?? ""));
    const answered = askedAt >= 0 && lines.slice(askedAt + 1).some((l) => l.direction === "INBOUND" && l.body?.trim());
    const asksCity = /ciudad/i.test(ownText(ctx)) && !/ciudad/i.test(lines[askedAt]?.body ?? "");
    const again = answered && ASKS_COUNTRY.test(ownText(ctx)) && !asksCity;
    return { id: "no_repite_pregunta_pais", pass: !again };
  },
  un_paso_a_la_vez: (ctx) => {
    // Preguntar dónde está y a la vez darle horas (¿en qué hora, entonces?).
    const both = ASKS_COUNTRY.test(ownText(ctx)) && SLOT_LIST.test(ownText(ctx));
    return { id: "un_paso_a_la_vez", pass: !both };
  },
  agendada_solo_si_agendo: (ctx) => {
    if (!BOOKED_CLAIM.test(ownText(ctx))) return { id: "agendada_solo_si_agendo", pass: true };
    const booked =
      usedTool(ctx, "book_free_call", (o) => o.booked === true || o.alreadyBooked === true || o.simulated === true) ||
      usedTool(ctx, "book_appointment", (o) => o.simulated === true) ||
      usedTool(ctx, "confirm_appointment", (o) => o.ok === true);
    return { id: "agendada_solo_si_agendo", pass: booked, detail: booked ? undefined : "dice agendada sin agendar" };
  },
  como_mucho_dos_preguntas: (ctx) => {
    const n = (ownText(ctx).match(/\?/g) ?? []).length;
    return { id: "como_mucho_dos_preguntas", pass: n <= 2, detail: n > 2 ? `${n} preguntas` : undefined };
  },
  genero_sin_adivinar: (ctx) => {
    if (!ctx.gender) return { id: "genero_sin_adivinar", pass: true };
    for (const m of ownText(ctx).matchAll(PERSON_GENDERED)) {
      const ending = (m[1] ?? m[2] ?? "").toLowerCase();
      const wrong = ctx.gender === "unknown" || (ctx.gender === "f" && ending === "o") || (ctx.gender === "m" && ending === "a");
      if (wrong) return { id: "genero_sin_adivinar", pass: false, detail: m[0] };
    }
    return { id: "genero_sin_adivinar", pass: true };
  },
  no_usa_nombre_de_perfil: (ctx) => {
    // Un perfil que no es un nombre no se usa para llamar a la persona.
    const profile = ctx.profileName?.trim();
    if (!profile || personFirstName(profile)) return { id: "no_usa_nombre_de_perfil", pass: true };
    const text = foldForSearch(ownText(ctx));
    const tokens = foldForSearch(profile)
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const phrase = tokens.join(" ");
    const has = (w: string) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, "u").test(text);
    const hits = tokens.filter((w) => w.length >= 4 && has(w));
    const used = (phrase.length > 0 && text.includes(phrase)) || hits.length >= 2 || (tokens.length === 1 && has(tokens[0]!));
    return { id: "no_usa_nombre_de_perfil", pass: !used, detail: used ? profile : undefined };
  },
  promesas_con_respaldo: (ctx) => {
    // El mismo freno que run.ts (16-oct): horas que no dio la agenda, una cita
    // que no existe, «hoy mismo».
    const backing = [
      ...(ctx.backing ?? []),
      ...ctx.tools.flatMap((t) => {
        const o = (t.output ?? {}) as { options?: { label?: unknown }[]; label?: unknown };
        return [...(Array.isArray(o.options) ? o.options.map((x) => (typeof x.label === "string" ? x.label : "")) : []), typeof o.label === "string" ? o.label : ""];
      }),
    ].filter(Boolean);
    const booked =
      Boolean(ctx.hasBooking) ||
      usedTool(ctx, "book_free_call", (o) => o.booked === true || o.alreadyBooked === true || o.simulated === true) ||
      usedTool(ctx, "book_appointment", (o) => o.simulated === true) ||
      usedTool(ctx, "confirm_appointment", (o) => o.ok === true);
    const v = promiseBreach({ text: ownText(ctx), backing, hasBooking: booked, bookingToday: Boolean(ctx.bookingToday) });
    return { id: "promesas_con_respaldo", pass: !v, detail: v ? `${v.breach}: ${v.detail}` : undefined };
  },
  corto: (ctx) => {
    const words = ownText(ctx).split(/\s+/).filter(Boolean).length;
    return { id: "corto", pass: words <= 90, detail: words > 90 ? `${words} palabras` : undefined };
  },
};

/** Todas las reglas sobre una respuesta. */
export const gradeReply = (ctx: GradeContext): Grade[] => Object.values(GRADERS).map((g) => g(ctx));
