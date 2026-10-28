import { isSilentCategory } from "./chat-category-rules";
import { foldForSearch } from "./search-normalize";
import { isOptOutMessage } from "./whatsapp-outbound-plan";
import { WORKSHOP_CHOICE, workshopWhen, type OpenWorkshop } from "./whatsapp-agent/workshop-interest";

/**
 * Invitación al taller abierto a quienes se inscribieron en un evento gratuito
 * (dueña, 28-oct: «las personas que se inscribieron al webinar, ellos aceptaron
 * recibir información de talleres y eventos grupales, tanto de paga o no.
 * Entonces quiero también hacerle seguimiento a esas personas: que se les envíe
 * una invitación al taller, pero teniendo en cuenta de que es de pago»).
 *
 * El formulario del evento solo pedía «Acepto que Dayana me contacte y el
 * tratamiento de mis datos según el aviso de privacidad» (`consentDataAt`), que
 * no habla de talleres. Así que solo se invita a quien tiene el consentimiento
 * de novedades (`consentMarketingAt`, «Consentimiento marketing»: el mismo de la
 * invitación de la pestaña WhatsApp y de las campañas por correo), que desde el
 * 28-oct se pide aparte, sin marcar, en el formulario del evento.
 *
 * El mensaje dice que es un taller DE PAGO (sin el valor: lo ve en el enlace),
 * qué y cuándo, y hace la misma pregunta que la asistente (`WORKSHOP_CHOICE`):
 * separar el cupo con el enlace o agendar primero la llamada con Dayana. Sale
 * con `source` `asistente:taller:<edición>`, así que su respuesta sigue lo del
 * taller durante 3 días (`workshopLeadActive`) y entra en «Interesadas».
 *
 * Puro: lo usan `workshop-invite.ts`, la pantalla y las pruebas.
 */

/** Los eventos gratuitos de los últimos 60 días (los dos webinars de octubre; el de agosto ya no). */
export const INVITE_WINDOW_DAYS = 60;
/** `WhatsAppSend.kind` de estas invitaciones: el envío masivo genérico no las continúa. */
export const INVITE_SEND_KIND = "invitacion_taller";
/** La plantilla de Marketing para quien no escribió en las últimas 24 h (se manda sola a aprobar). */
export const INVITE_TEMPLATE_KEY = "taller_invitacion_inscritas";
/** Una invitación por persona y edición: la misma clave nunca sale dos veces (`sendMetaMessage`). */
export const inviteClientKey = (editionId: string, contactId: string): string => `taller-invita:${editionId}:${contactId}`;

/**
 * Fuera de las 24 h. Voz de la asistente, sin corazones ni «te bendigo»
 * (`retomar_conversacion` los lleva y dice «retomar nuestra conversación» a
 * gente que solo recibió recordatorios), dice por qué le escribimos y que es
 * de pago, y termina con la pregunta del cupo o la llamada (`isWorkshopChoice`).
 */
export const INVITE_TEMPLATE_BODY =
  "Hola {{nombre}}, soy la asistente de Dayana Beltrán. Como te inscribiste en uno de sus eventos gratuitos y aceptaste recibir información de sus talleres, te cuento que abrió el taller {{taller}}, que es el {{fecha}}. Es un taller de pago. ¿Quieres separar tu cupo ya con el enlace de pago (ahí ves el valor) o agendar primero una llamada con Dayana?";

export const INVITE_TEMPLATE_EXAMPLE: Record<string, string> = {
  nombre: "Ana",
  taller: "«Sana Tu Relación con el Dinero»",
  fecha: "domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual (hora de Colombia)",
};

// ── A quién ────────────────────────────────────────────────────────────────

export type InviteExclusion =
  | "no_consent"
  | "opted_out"
  | "no_phone"
  | "paid"
  | "personal"
  | "review"
  | "client"
  | "already_invited"
  | "interested"
  | "has_call"
  | "ai_blocked";

/** En el orden en que se miran (la primera que aplica es la que se cuenta). */
export const INVITE_EXCLUSIONS: readonly InviteExclusion[] = [
  "no_consent",
  "opted_out",
  "no_phone",
  "paid",
  "personal",
  "review",
  "client",
  "already_invited",
  "interested",
  "has_call",
  "ai_blocked",
];

export const INVITE_EXCLUSION_LABEL: Record<InviteExclusion, string> = {
  no_consent: "No aceptaron recibir información de talleres (solo el tratamiento de datos)",
  opted_out: "Pidieron no recibir WhatsApp",
  no_phone: "Sin un número de WhatsApp válido",
  paid: "Ya pagaron este taller",
  personal: "Número personal, de negocio, del equipo o ignorado",
  review: "Por revisar (¿clienta?)",
  client: "Clientas: las atiende Dayana",
  already_invited: "Ya se les invitó a este taller",
  interested: "Ya están en «Interesadas»: escríbeles desde ahí",
  has_call: "Tienen una llamada agendada con Dayana",
  ai_blocked: "La IA no atiende ese chat (favorito, tomado, Manual, pausa o asignado)",
};

export type InviteFacts = {
  /** `consentMarketingAt`: aceptó recibir novedades (talleres y eventos). */
  consentMarketing: boolean;
  /** `notifyWhatsapp` apagado (pidió la baja). */
  optedOut: boolean;
  /** Un E.164 de verdad (no `+pending:`, no `+nophone`). */
  phoneOk: boolean;
  paidWorkshop: boolean;
  segment: string | null;
  stage: string | null;
  segmentReview: boolean;
  category: string | null;
  categorySource: string | null;
  ignoredNumber: boolean;
  alreadyInvited: boolean;
  inInterests: boolean;
  hasUpcomingCall: boolean;
  /** `waitingRoomBlocked` o asignado a alguien del equipo sin «La IA responde siempre». */
  aiBlocked: boolean;
};

/**
 * Por qué no le llega, o null si le llega. Clienta = pagó y Dayana lo
 * confirmó (el segmento o su marca a mano «cliente»); la categoría que puso
 * la IA no hace clienta a nadie (dueña, 14-oct).
 */
export const inviteExclusion = (f: InviteFacts): InviteExclusion | null => {
  if (!f.consentMarketing) return "no_consent";
  if (f.optedOut) return "opted_out";
  if (!f.phoneOk) return "no_phone";
  if (f.paidWorkshop) return "paid";
  if (f.ignoredNumber || f.segment === "ignored" || f.stage === "personal" || isSilentCategory(f.category)) return "personal";
  if (f.segmentReview || f.stage === "por_revisar") return "review";
  if (
    f.segment === "client" ||
    f.stage === "clienta_activa" ||
    f.stage === "clienta_pasada" ||
    (f.categorySource === "manual" && f.category === "cliente")
  ) {
    return "client";
  }
  if (f.alreadyInvited) return "already_invited";
  if (f.inInterests) return "interested";
  if (f.hasUpcomingCall) return "has_call";
  if (f.aiBlocked) return "ai_blocked";
  return null;
};

/** Cuántas quedan fuera por cada motivo, en el orden de `INVITE_EXCLUSIONS` y sin los ceros. */
export const countExclusions = (reasons: (InviteExclusion | null)[]): { reason: InviteExclusion; label: string; count: number }[] =>
  INVITE_EXCLUSIONS.map((reason) => ({ reason, label: INVITE_EXCLUSION_LABEL[reason], count: reasons.filter((r) => r === reason).length })).filter(
    (r) => r.count > 0
  );

/** Desde cuándo cuentan los eventos (por su fecha; sin fecha, por cuándo se creó). */
export const inviteWindowStart = (now: Date): Date => new Date(now.getTime() - INVITE_WINDOW_DAYS * 24 * 3600_000);

// ── Qué le llega ──────────────────────────────────────────────────────────

export type InviteEvent = { headline: string; eventLabel: string; startsAt: Date | null };

/** «Webinar Gratuito» como título no dice nada: entonces el tipo y la fecha. */
const GENERIC_HEADLINE = /^(webinar|masterclass|master class|clase|evento|charla|encuentro|taller)( (gratuito|gratuita|gratis|en vivo|online|virtual))*$/;

const shortDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone, day: "numeric", month: "long" }).format(d);

/**
 * En qué evento se inscribió, sin artículo con género («su masterclass
 * gratuita «Reprograma tu mente con PNL»», «su webinar gratuito del 25 de
 * octubre»); sin evento, «uno de sus eventos gratuitos».
 */
export const inviteEventMention = (e: InviteEvent | null, timeZone = "America/Bogota"): string => {
  if (!e) return "uno de sus eventos gratuitos";
  const label = oneLine(e.eventLabel).toLowerCase() || "evento gratuito";
  const headline = oneLine(e.headline);
  const generic = !headline || GENERIC_HEADLINE.test(foldForSearch(headline)) || foldForSearch(headline) === foldForSearch(label);
  if (generic) return e.startsAt ? `su ${label} del ${shortDate(e.startsAt, timeZone)}` : `su ${label}`;
  return `su ${label} «${headline}»`;
};

/** Una línea, sin espacios de más (las variables de una plantilla no admiten saltos). */
const oneLine = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** De qué trata, si es corto (el mensaje no se vuelve un folleto). */
const SUMMARY_MAX = 220;
const summaryOf = (w: OpenWorkshop): string | null => {
  const s = oneLine(w.cardSummary);
  if (!s || s.length > SUMMARY_MAX) return null;
  return /[.!?…]$/.test(s) ? s : `${s}.`;
};

/** ¿Se le puede invitar? Con su enlace de pago (es de pago) y con fecha. */
export const inviteBlockedReason = (w: Pick<OpenWorkshop, "payUrl" | "startsAt" | "dateLabel">): string | null => {
  if (!w.payUrl) return "Ponle precio al taller (pestaña «Precio»): la invitación es para un taller de pago y lleva a su enlace.";
  if (!w.startsAt && !oneLine(w.dateLabel)) return "Ponle fecha al taller (pestaña «Página»): la invitación dice cuándo es.";
  return null;
};

/**
 * Dentro de las 24 h, el texto (`firstName` solo si es un nombre seguro):
 *
 * «Hola Ana 🙏 Soy la asistente de Dayana Beltrán. Como te inscribiste en su
 * webinar gratuito del 25 de octubre y aceptaste recibir información de sus
 * talleres, te cuento que abrió el taller «Sana Tu Relación con el Dinero»:
 * es el domingo 15 de noviembre, … (hora de Colombia). <De qué trata.> Es un
 * taller de pago.
 *
 * ¿Quieres separar tu cupo ya con el enlace de pago (ahí ves el valor) o
 * agendar primero una llamada con Dayana?»
 */
export const workshopInviteText = (
  w: OpenWorkshop,
  opts: { firstName: string | null; event: InviteEvent | null; timeZone?: string }
): string => {
  const hi = opts.firstName ? `Hola ${opts.firstName} 🙏` : "Hola 🙏";
  const when = workshopWhen(w);
  const summary = summaryOf(w);
  const intro = `${hi} Soy la asistente de Dayana Beltrán. Como te inscribiste en ${inviteEventMention(opts.event, opts.timeZone)} y aceptaste recibir información de sus talleres, te cuento que abrió el taller «${oneLine(w.title)}»${when ? `: es el ${when} (hora de Colombia)` : ""}.`;
  return [`${intro}${summary ? ` ${summary}` : ""} Es un taller de pago.`, WORKSHOP_CHOICE].join("\n\n");
};

/** El título cabe en la variable sin volverse el mensaje entero. */
const TITLE_MAX = 90;

/** Las variables de `INVITE_TEMPLATE_BODY`. Sin nombre seguro, «Hola 😊,» (WhatsApp no acepta el parámetro vacío). */
export const workshopInviteTemplateVars = (w: OpenWorkshop, opts: { firstName: string | null }): Record<string, string> => {
  const title = oneLine(w.title);
  const when = oneLine(workshopWhen(w));
  return {
    nombre: opts.firstName ?? "😊",
    taller: `«${title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX).trimEnd()}…` : title}»`,
    fecha: when ? `${when} (hora de Colombia)` : "próximamente",
  };
};

// ── Su respuesta ──────────────────────────────────────────────────────────

/**
 * «No me interesa», «no gracias», «baja»: la respuesta entra en «Interesadas»
 * ya marcada «No le interesa», para que Dayana no la llame por eso. Solo
 * mensajes cortos: «no puedo ese día, ¿hay otro?» no es un no.
 */
export const declinesInvite = (body: string | null | undefined): boolean => {
  if (isOptOutMessage(body)) return true;
  const t = foldForSearch(body ?? "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 60) return false;
  return /^(no|nop|no gracias|gracias no|no me interesa|no me interesa gracias|gracias no me interesa|no estoy interesad[ao]|por ahora no|ahora no|no por ahora|no por el momento|por el momento no)( gracias)?$/.test(t);
};
