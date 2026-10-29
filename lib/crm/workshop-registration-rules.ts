import { isSilentCategory } from "./chat-category-rules";
import { WORKSHOP_CHOICE, workshopWhen, type OpenWorkshop } from "./whatsapp-agent/workshop-interest";

/**
 * Registro de interés en el taller desde la página (dueña, 28-oct:
 * «básicamente todo el flujo viene desde la página de enlaces. Quiero que
 * cuando se crea un taller aparezca ahí en la página de enlaces el botón del
 * taller, que diga "Taller" y abajo del taller el nombre, y colocarle "si estás
 * interesado, regístrate". Es para clasificar la gente interesada… la gente que
 * oprime ahí en taller se registra y se clasifica como interesada; una vez
 * clasificada, se le envía un mensaje automático, como se hacen los del
 * webinar, pero en este caso para que realice el pago del taller o agende una
 * llamada gratuita»). Casi todas llegan de TikTok por `/enlaces`, y desde
 * TikTok es mejor una página del sitio donde dejan sus datos que mandarlas
 * directo a WhatsApp. Registrarse es gratis y no da acceso: marca interés.
 *
 * Así:
 *
 * - `/enlaces` muestra el botón «Taller» con el nombre de la edición abierta
 *   (la misma regla que `openWorkshopForAi`) y «Si te interesa, regístrate».
 * - `/taller-virtual/<slug>/registro`: nombre, WhatsApp, correo opcional. Crea
 *   o actualiza el contacto (etiqueta `taller-interes`) y la anota en
 *   «Interesadas» de esa edición.
 * - Enseguida, el WhatsApp de la asistente: recibimos tu registro, separar el
 *   cupo con el enlace de pago (ahí ve el valor: nunca se escribe un precio) o
 *   primero una llamada gratis con Dayana, y la misma pregunta que la IA
 *   (`WORKSHOP_CHOICE`). Sale con `source` `asistente:taller:<edición>`, así
 *   que su respuesta sigue el flujo del taller durante 3 días.
 *
 * Sin migración: la fila de «Interesadas» se marca en `offered_via` con
 * `pagina:<estado>` (cómo quedó ese WhatsApp) y, si la fila nace del registro,
 * `first_message` es `PAGE_REGISTRATION_MESSAGE`.
 *
 * Puro: lo usan `workshop-registration.ts`, la ruta, la página, el CRM y las pruebas.
 */

// ── Dónde ─────────────────────────────────────────────────────────────────

/** La página del registro. */
export const workshopRegistrationPath = (slug: string): string => `/taller-virtual/${encodeURIComponent(slug)}/registro`;

/** El botón de `/enlaces`: el texto de la dueña, en neutro («si estás interesado» → «si te interesa»). */
export const WORKSHOP_LINK_CTA = { title: "Taller", note: "Si te interesa, regístrate" } as const;

/**
 * ¿Se puede registrar? La misma regla que `openWorkshopForAi` (y el botón de
 * `/enlaces`): publicado, sin terminar y no pasó hace más de un día.
 */
export const isRegistrationOpen = (
  e: { status: string; endedAt: Date | null; startsAt: Date | null },
  now: Date = new Date()
): boolean => e.status === "OPEN" && !e.endedAt && (!e.startsAt || e.startsAt.getTime() >= now.getTime() - 24 * 3600_000);

// ── El contacto ───────────────────────────────────────────────────────────

export const WORKSHOP_INTEREST_TAG_SLUG = "taller-interes";
export const WORKSHOP_INTEREST_TAG_LABEL = "Interés en taller";

/** `first_message` de una fila que nace del registro (no hay mensaje suyo de WhatsApp). */
export const PAGE_REGISTRATION_MESSAGE = "Se registró en la página del taller.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export type RegistrationInput = {
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string;
  phoneCountry: string | null;
  /** La casilla aparte, sin marcar, de talleres y eventos grupales (`consentMarketingAt`). */
  consentMarketing: boolean;
  /** De dónde viene («enlaces»): va al detalle de origen. */
  ref: string | null;
};

export type RegistrationParse =
  | { ok: true; value: RegistrationInput }
  | { ok: false; error: "honeypot" | "missing_fields" | "consent_required" | "invalid_email" };

/**
 * Lo que manda el formulario. La trampa para bots (`hp`, como `/api/leads`)
 * primero: quien la rellena recibe un «listo» y no se guarda nada.
 */
export const parseRegistrationBody = (body: unknown): RegistrationParse => {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.hp === "string" && b.hp.trim()) return { ok: false, error: "honeypot" };
  const firstName = clip(b.firstName, 60);
  const phone = clip(b.phone, 32);
  if (!firstName || !phone) return { ok: false, error: "missing_fields" };
  if (b.consentData !== true) return { ok: false, error: "consent_required" };
  const email = clip(b.email, 120).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "invalid_email" };
  // Entero y luego se mira: cortado a 2, «Colombia» sería «CO» por casualidad.
  const country = clip(b.phoneCountry, 8).toUpperCase();
  const ref = clip(b.ref, 40).toLowerCase();
  return {
    ok: true,
    value: {
      firstName,
      lastName: clip(b.lastName, 60) || null,
      email: email || null,
      phone,
      phoneCountry: /^[A-Z]{2}$/.test(country) ? country : null,
      consentMarketing: b.consentMarketing === true,
      ref: /^[a-z0-9_-]+$/.test(ref) ? ref : null,
    },
  };
};

/** El detalle de origen del contacto: «Interés en taller: <título> (Enlaces)». */
export const registrationSourceDetail = (title: string, ref: string | null): string => {
  const from = ref === "enlaces" ? " (Enlaces)" : ref ? ` (${ref})` : "";
  return `Interés en taller: ${title.replace(/\s+/g, " ").trim()}${from}`.slice(0, 190);
};

// ── El WhatsApp ───────────────────────────────────────────────────────────

/**
 * La plantilla para quien no escribió en las últimas 24 h (casi todas: llegan
 * de TikTok). De UTILIDAD (dueña, 28-oct: «toca que crees una plantilla pero
 * que no sea de marketing ya que la persona aceptó»): es la confirmación de su
 * propio registro, recién hecho, y cómo completar la inscripción, como
 * `evento_acceso` en los eventos gratuitos. Por eso el texto es estrictamente
 * de su trámite: sin «gratis», sin palabras de venta (`utilityCategoryWarning`),
 * sin precio, sin emojis. Meta tiene la última palabra: si al revisarla la pasa
 * a Marketing, no se usa sola (`approvedUtilityTemplateFor`) y la fila de
 * «Interesadas» lo dice. Se manda sola a aprobar.
 */
export const REGISTRATION_TEMPLATE_KEY = "taller_registro_pagina";
export const REGISTRATION_TEMPLATE_TITLE = "Taller: registro en la página";

/**
 * Asistente, sin corazones ni «te bendigo», neutro, una sola línea. Lleva la
 * pregunta del cupo o la llamada (`isWorkshopChoice`) para que su respuesta
 * siga el mismo flujo que con la IA: «el enlace» → el enlace; «la llamada» → las horas.
 */
export const REGISTRATION_TEMPLATE_BODY =
  "Hola {{nombre}}, soy la asistente de Dayana Beltrán. Recibimos tu registro para el taller {{taller}} ({{fecha}}). Para completar tu inscripción puedes hacer el pago en el enlace de inscripción, donde ves el valor, o agendar primero una llamada con Dayana, donde te explica el taller. ¿Prefieres el enlace para separar tu cupo o agendar la llamada? Responde a este mensaje y te ayudo.";

export const REGISTRATION_TEMPLATE_EXAMPLE: Record<string, string> = {
  nombre: "Ana",
  taller: "«Tu Sanación con el Dinero»",
  fecha: "domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual, hora de Colombia",
};

/**
 * Una por chat y edición: la misma clave nunca sale dos veces
 * (`sendMetaMessage` devuelve el mensaje que ya existe).
 */
export const registrationClientKey = (editionId: string, conversationId: string): string =>
  `taller-registro:${editionId}:${conversationId}`;

/**
 * El formulario es público y la plantilla se paga: un tope por edición, como
 * `EVENT_CONFIRMATION_CAP`, para que un bot con números inventados no la
 * convierta en un gasto. Pasado el tope, la persona queda en «Interesadas» sin
 * el mensaje (con el motivo).
 */
export const WORKSHOP_REGISTRATION_CAP = { perHour: 40, perDay: 300 } as const;

const oneLine = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** «domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual, hora de Colombia», o null sin fecha. */
export const registrationWhen = (w: OpenWorkshop): string | null => {
  const when = oneLine(workshopWhen(w));
  return when ? `${when}, hora de Colombia` : null;
};

/** Sin enlace de pago (el taller no tiene precio): la inscripción es con la llamada, como antes del 25-oct. */
const CALL_ONLY = "Para participar, primero tienes una llamada gratis con Dayana: ahí te explica de qué se trata el taller, cuánto cuesta y te inscribe.";
const CALL_ONLY_ASK = "¿Quieres que te la separe?";

/**
 * Dentro de las 24 h, el texto (`firstName` solo el que escribió en el formulario):
 *
 * «Hola Ana 🙏 Soy la asistente de Dayana Beltrán. Recibimos tu registro para
 * el taller «Tu Sanación con el Dinero» (domingo 15 de noviembre, …, hora de
 * Colombia). Para completar tu inscripción puedes hacer el pago en el enlace de
 * inscripción o agendar primero una llamada gratis con Dayana, donde te explica
 * el taller y su valor.
 *
 * ¿Quieres separar tu cupo ya con el enlace de pago (ahí ves el valor) o
 * agendar primero una llamada con Dayana?»
 *
 * Lo mismo que dice la plantilla (`REGISTRATION_TEMPLATE_BODY`), y termina con
 * la pregunta de la IA (`WORKSHOP_CHOICE`).
 */
export const workshopRegistrationText = (w: OpenWorkshop, opts: { firstName: string | null }): string => {
  const hi = opts.firstName ? `Hola ${opts.firstName} 🙏` : "Hola 🙏";
  const when = registrationWhen(w);
  const intro = `${hi} Soy la asistente de Dayana Beltrán. Recibimos tu registro para el taller «${oneLine(w.title)}»${when ? ` (${when})` : ""}.`;
  return w.payUrl
    ? `${intro} Para completar tu inscripción puedes hacer el pago en el enlace de inscripción o agendar primero una llamada gratis con Dayana, donde te explica el taller y su valor.\n\n${WORKSHOP_CHOICE}`
    : `${intro} ${CALL_ONLY}\n\n${CALL_ONLY_ASK}`;
};

const TITLE_MAX = 90;

/** Las variables de `REGISTRATION_TEMPLATE_BODY`. Sin nombre, «Hola 😊,» (WhatsApp no acepta el parámetro vacío). */
export const workshopRegistrationTemplateVars = (w: OpenWorkshop, opts: { firstName: string | null }): Record<string, string> => {
  const title = oneLine(w.title);
  return {
    nombre: opts.firstName ?? "😊",
    taller: `«${title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX).trimEnd()}…` : title}»`,
    fecha: registrationWhen(w) ?? "fecha por confirmar",
  };
};

// ── Cuándo no sale ────────────────────────────────────────────────────────

/**
 * Cómo quedó el WhatsApp del registro, guardado en `offered_via` como
 * `pagina:<estado>`. `text` / `template`: salió. `enviando`: reclamado.
 * Los demás: por qué no salió (lo ve Dayana en «Interesadas»).
 */
export const REGISTRATION_STATES = [
  "enviando",
  "text",
  "template",
  "plantilla",
  "marketing",
  "sin_precio",
  "tope",
  "baja",
  "sin_numero",
  "pagado",
  "personal",
  "clienta",
  "revisar",
  "ia",
  "llamada",
  "ya_escrito",
  "cerrado",
  "fallo",
] as const;
export type RegistrationState = (typeof REGISTRATION_STATES)[number];

const PAGE_PREFIX = "pagina:";
export const pageVia = (state: RegistrationState): string => `${PAGE_PREFIX}${state}`;

/** `offered_via` → ¿se registró en la página? y cómo quedó su WhatsApp. Un estado que no se conoce es un fallo. */
export const parsePageVia = (raw: string | null | undefined): { page: false } | { page: true; state: RegistrationState } => {
  if (!raw?.startsWith(PAGE_PREFIX)) return { page: false };
  const state = raw.slice(PAGE_PREFIX.length);
  return { page: true, state: (REGISTRATION_STATES as readonly string[]).includes(state) ? (state as RegistrationState) : "fallo" };
};

export type RegistrationFacts = {
  optedOut: boolean;
  phoneOk: boolean;
  paid: boolean;
  ignoredNumber: boolean;
  segment: string | null;
  stage: string | null;
  segmentReview: boolean;
  category: string | null;
  categorySource: string | null;
  /** La IA apagada o su agenda apagada (`outreachAiOff`). */
  aiOff: boolean;
  /** Asignado a alguien del equipo, o la IA no atiende ese chat (`waitingRoomBlocked`). */
  aiBlocked: boolean;
  hasUpcomingCall: boolean;
  /** Ya le escribimos por esta edición en las últimas 24 h (invitación, «Que la IA le escriba»). */
  contactedToday: boolean;
};

export type RegistrationSkip = Exclude<
  RegistrationState,
  "enviando" | "text" | "template" | "plantilla" | "marketing" | "sin_precio" | "tope" | "cerrado" | "fallo"
>;

/**
 * Por qué no le escribimos, o null si sí. Nunca a quien pidió la baja, a un
 * número personal / ignorado ni a una clienta (pagó y Dayana lo confirmó: el
 * segmento o su marca a mano «cliente»; la etiqueta de la IA sola no hace
 * clienta a nadie, dueña 14-oct); nada si ya pagó esta edición. Tampoco si la
 * IA no podría seguirle la respuesta, si ya tiene llamada con Dayana (ahí le
 * explica) o si hoy ya le escribimos por este taller.
 */
export const registrationSkip = (f: RegistrationFacts): RegistrationSkip | null => {
  if (f.optedOut) return "baja";
  if (!f.phoneOk) return "sin_numero";
  if (f.paid) return "pagado";
  if (f.ignoredNumber || f.segment === "ignored" || f.stage === "personal" || isSilentCategory(f.category)) return "personal";
  if (
    f.segment === "client" ||
    f.stage === "clienta_activa" ||
    f.stage === "clienta_pasada" ||
    (f.categorySource === "manual" && f.category === "cliente")
  ) {
    return "clienta";
  }
  if (f.segmentReview || f.stage === "por_revisar") return "revisar";
  if (f.aiOff || f.aiBlocked) return "ia";
  if (f.hasUpcomingCall) return "llamada";
  if (f.contactedToday) return "ya_escrito";
  return null;
};

// ── Lo que ve Dayana ──────────────────────────────────────────────────────

export const REGISTRATION_STATE_LABEL: Record<Exclude<RegistrationState, "text" | "template">, string> = {
  enviando: "Se está enviando.",
  plantilla: `No había escrito en las últimas 24 h y Meta todavía no aprueba la plantilla «${REGISTRATION_TEMPLATE_TITLE}». Escríbele tú o usa «Que la IA le escriba».`,
  marketing: `No había escrito en las últimas 24 h y Meta aprobó la plantilla «${REGISTRATION_TEMPLATE_TITLE}» como Marketing, no como Utilidad: no se envía sola. Revísala en WhatsApp → Plantillas o escríbele tú.`,
  sin_precio: "No había escrito en las últimas 24 h y el taller no tiene precio (la plantilla habla del enlace de pago).",
  tope: `Tope de mensajes automáticos del registro (${WORKSHOP_REGISTRATION_CAP.perHour} por hora, ${WORKSHOP_REGISTRATION_CAP.perDay} por día): no se le escribió.`,
  baja: "Pidió no recibir WhatsApp.",
  sin_numero: "Su número no es un WhatsApp válido.",
  pagado: "Ya pagó el taller.",
  personal: "Número personal, de negocio, del equipo o ignorado.",
  clienta: "Es clienta: la atiendes tú.",
  revisar: "Su chat está por revisar (¿clienta?): escríbele tú.",
  ia: "La IA está apagada o no atiende este chat (favorito, tomado, Manual, pausa o asignado): escríbele tú.",
  llamada: "Ya tiene una llamada agendada con Dayana: ahí le explica.",
  ya_escrito: "Ese día ya le habíamos escrito por este taller.",
  cerrado: "El taller ya no estaba abierto.",
  fallo: "WhatsApp no lo aceptó.",
};

/**
 * Cómo está la plantilla del registro en Meta, para la cabecera de
 * «Interesadas»: Dayana ve de un vistazo si los registros de quien no escribió
 * en 24 h reciben el WhatsApp. Meta decide la categoría al aprobarla: si la
 * pasa a Marketing, se dice claro (y no sale sola).
 */
export const registrationTemplateNotice = (
  t: { status: string | null; category: string | null } | null
): { tone: "ok" | "warn" | "info"; text: string } => {
  const name = `«${REGISTRATION_TEMPLATE_TITLE}»`;
  const status = (t?.status ?? "").toUpperCase();
  if (!t || !status) return { tone: "info", text: `Plantilla ${name}: se manda sola a aprobar (como Utilidad) con el primer registro de alguien que no escribió en 24 h.` };
  if (status === "APPROVED") {
    return (t.category ?? "").toUpperCase() === "UTILITY"
      ? { tone: "ok", text: `Plantilla ${name}: aprobada como Utilidad. A quien no escribió en 24 h le llega con ella.` }
      : {
          tone: "warn",
          text: `Plantilla ${name}: Meta la aprobó como ${t.category ? (t.category.toUpperCase() === "MARKETING" ? "Marketing" : t.category) : "otra categoría"}, no como Utilidad. No se envía sola: revísala en WhatsApp → Plantillas.`,
        };
  }
  if (status.startsWith("REJECTED")) return { tone: "warn", text: `Plantilla ${name}: Meta la rechazó. Se vuelve a mandar sola a aprobar con el próximo registro.` };
  return { tone: "info", text: `Plantilla ${name}: en revisión de Meta. Mientras tanto, a quien no escribió en 24 h no le llega el WhatsApp (queda anotado).` };
};

/** Un «se está enviando» de hace más que esto es que la invocación se cortó. */
const STUCK_MS = 5 * 60_000;

export type RegistrationWaStatus = {
  kind: "sent" | "pending" | "skipped" | "failed";
  /** Corto, para la insignia. */
  label: string;
  /** El motivo, para la línea de abajo. */
  detail: string | null;
  /** Cuándo salió (solo `sent`). */
  sentAt: Date | null;
  via: "text" | "template" | null;
};

/**
 * Lo que dice la fila de «Interesadas» sobre el WhatsApp del registro. Manda
 * el mensaje mismo si existe (su clave `registrationClientKey`): salió, se
 * entregó, lo leyó o WhatsApp avisó que no llegó; si no hay mensaje, el estado
 * guardado dice por qué.
 */
export const registrationWaStatus = (input: {
  state: RegistrationState;
  message: { status: string; sentAt: Date; failedReason: string | null } | null;
  updatedAt: Date;
  now?: Date;
}): RegistrationWaStatus => {
  const { state, message } = input;
  const now = input.now ?? new Date();
  const via = state === "template" ? "template" : state === "text" ? "text" : null;
  if (message) {
    if (message.status === "FAILED") {
      return { kind: "failed", label: "WhatsApp no llegó", detail: message.failedReason?.trim() || REGISTRATION_STATE_LABEL.fallo, sentAt: null, via };
    }
    const seen = message.status === "READ" ? " · leído" : message.status === "DELIVERED" ? " · entregado" : "";
    return { kind: "sent", label: `WhatsApp enviado${via === "template" ? " (plantilla)" : ""}${seen}`, detail: null, sentAt: message.sentAt, via };
  }
  if (state === "text" || state === "template") {
    // Anotado como enviado pero sin su mensaje (lo borraron del chat).
    return { kind: "sent", label: "WhatsApp enviado", detail: null, sentAt: null, via };
  }
  if (state === "enviando") {
    return now.getTime() - input.updatedAt.getTime() > STUCK_MS
      ? { kind: "failed", label: "WhatsApp: no se sabe si salió", detail: "El envío se cortó: revisa el chat.", sentAt: null, via: null }
      : { kind: "pending", label: "WhatsApp enviándose", detail: null, sentAt: null, via: null };
  }
  if (state === "plantilla") {
    return { kind: "pending", label: "WhatsApp: espera la plantilla", detail: REGISTRATION_STATE_LABEL.plantilla, sentAt: null, via: null };
  }
  if (state === "marketing") {
    return { kind: "pending", label: "WhatsApp: Meta pasó la plantilla a Marketing", detail: REGISTRATION_STATE_LABEL.marketing, sentAt: null, via: null };
  }
  if (state === "fallo") return { kind: "failed", label: "WhatsApp no salió", detail: REGISTRATION_STATE_LABEL.fallo, sentAt: null, via: null };
  return { kind: "skipped", label: "WhatsApp no enviado", detail: REGISTRATION_STATE_LABEL[state], sentAt: null, via: null };
};
