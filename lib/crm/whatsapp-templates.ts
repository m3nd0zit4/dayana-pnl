import { prisma } from "@/lib/db";
import { Dialog360Error, dialog360Request } from "@/lib/meta/whatsapp-provider";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import {
  EVENT_ACCESS_TEMPLATE_KEY,
  EVENT_INVITATION_IMAGE_TEMPLATE_KEY,
  EVENT_INVITATION_TEMPLATE_KEY,
  EVENT_REMINDER_FALLBACK_TEMPLATE_KEY,
  EVENT_REMINDER_UTILITY_TEMPLATE_KEY,
  EVENT_REMINDER_UTILITY_TEMPLATE_TITLE,
  EVENT_TEMPLATE_KEYS_TO_ENSURE,
  preferredEventReminderTemplateKey,
  RETIRED_TEMPLATES,
  retiredTemplateRemovable,
} from "./event-reminder-template";
import { scheduleVars } from "./event-schedule";
import { EVENT_ACCESS_BODY, EVENT_INVITATION_BODY } from "./event-template-vars";
import { toMetaBody } from "./whatsapp-template-rules";

/**
 * Plantillas de WhatsApp (las que Meta aprueba) conectadas con el CRM.
 *
 * Para escribirle a alguien que no escribió en las últimas 24 h, WhatsApp
 * exige una plantilla aprobada. Aquí se crean desde el CRM (360dialog las
 * manda a Meta), se sincroniza su estado, y cada una queda ligada a una clave
 * del CRM (`evento_gratis_invitacion`, `enlace_de_pago`…) para que los envíos
 * usen la que corresponde sin que nadie tenga que elegirla.
 *
 * El texto aprobado usa {{1}}, {{2}}…; `metaVarNames` dice qué dato del CRM va
 * en cada uno (nombre, evento, fecha, enlace…).
 */

export type TemplateCategory = "UTILITY" | "MARKETING";

export type StarterTemplate = {
  key: string;
  title: string;
  category: TemplateCategory;
  /** Texto con {{nombre}}, {{evento}}… (se convierte a {{1}}… al enviarla a Meta). */
  body: string;
  example: Record<string, string>;
  /**
   * Con imagen arriba: el CRM solo crea plantillas de texto, así que esta se
   * crea a mano en el Hub (la página dice cómo) y nunca se manda sola.
   */
  manual?: boolean;
  /**
   * Retirada: la reemplazan estas. Su fila queda (es el respaldo hasta que
   * Meta apruebe las nuevas), pero nunca se vuelve a mandar a aprobar.
   */
  replacedBy?: string[];
};

/** Fecha de ejemplo para Meta: domingo 4 de octubre, 9:30 a. m. en Colombia. */
const SAMPLE_STARTS_AT = new Date("2026-10-04T14:30:00Z");

const EVENT_INVITATION_EXAMPLE: Record<string, string> = {
  nombre: "Ana",
  mensaje: "te invito a una clase en vivo para soltar lo que ya no te sirve.",
  evento: "«Reprograma tu mente con PNL»",
  fecha: "domingo 4 de octubre",
  precio: "Gratis",
  enlace: "https://www.dayanabeltran.com/eventos-gratuitos",
  ...scheduleVars(SAMPLE_STARTS_AT),
};

/** Las que conviene tener aprobadas desde el principio. Editables antes de enviarlas. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  // Con el horario por país (`event-template-vars.ts`). Las cuatro de antes
  // (invitación y recordatorio de evento y de taller) quedan de respaldo.
  {
    key: EVENT_ACCESS_TEMPLATE_KEY,
    title: "Evento o taller: acceso con horarios (inscritas)",
    category: "UTILITY",
    body: EVENT_ACCESS_BODY,
    example: {
      nombre: "Ana",
      evento: "«Reprograma tu mente con PNL»",
      fecha: "domingo 4 de octubre",
      enlace: "https://meet.google.com/abc-defg-hij",
      ...scheduleVars(SAMPLE_STARTS_AT),
    },
  },
  {
    key: EVENT_INVITATION_TEMPLATE_KEY,
    title: "Evento o taller: invitación con horarios",
    category: "MARKETING",
    body: EVENT_INVITATION_BODY,
    example: EVENT_INVITATION_EXAMPLE,
  },
  {
    key: EVENT_INVITATION_IMAGE_TEMPLATE_KEY,
    title: "Evento o taller: invitación con imagen y horarios",
    category: "MARKETING",
    body: EVENT_INVITATION_BODY,
    example: EVENT_INVITATION_EXAMPLE,
    manual: true,
  },
  {
    key: "evento_gratis_invitacion",
    title: "Evento gratuito: invitación",
    replacedBy: RETIRED_TEMPLATES.evento_gratis_invitacion,
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Te invito a {{evento}}, gratis, el {{fecha}}. Reserva tu lugar aquí: {{enlace}} ¡Te espero!",
    example: { nombre: "Ana", evento: "la masterclass Reprograma tu mente", fecha: "jueves 2 de octubre, 7:00 p. m.", enlace: "https://www.dayanabeltran.com/eventos-gratuitos" },
  },
  {
    key: "evento_gratis_recordatorio",
    title: "Evento gratuito: recordatorio",
    // El de 24 h pasa a `evento_acceso`; el de 1 h, a la corta de utilidad.
    replacedBy: RETIRED_TEMPLATES[EVENT_REMINDER_FALLBACK_TEMPLATE_KEY],
    category: "UTILITY",
    body: "Hola {{nombre}}, te recuerdo que {{evento}} es el {{fecha}}. Entra aquí: {{enlace}} Nos vemos pronto 💛",
    example: { nombre: "Ana", evento: "la masterclass", fecha: "hoy a las 7:00 p. m.", enlace: "https://www.dayanabeltran.com/eventos-gratuitos" },
  },
  // El recordatorio a quien se inscribió, de UTILIDAD: Meta pasó la de arriba
  // a Marketing por el tono cálido. Estrictamente informativa (sin emojis ni
  // palabras de venta) y ligada a su inscripción. Mismas variables que la de
  // arriba; se prefiere en cuanto Meta la aprueba como UTILITY.
  {
    key: EVENT_REMINDER_UTILITY_TEMPLATE_KEY,
    title: EVENT_REMINDER_UTILITY_TEMPLATE_TITLE,
    category: "UTILITY",
    body: "Hola {{nombre}}, te escribimos porque te inscribiste en {{evento}}. Recordatorio: es el {{fecha}}. Enlace para ingresar: {{enlace}} Si ya no puedes asistir, responde este mensaje.",
    example: {
      nombre: "Ana",
      evento: "la masterclass Reprograma tu mente con PNL",
      fecha: "domingo 4 de octubre a las 9:30 a. m. (hora de Colombia)",
      enlace: "https://meet.google.com/abc-defg-hij",
    },
  },
  // Al inscribirse. De UTILIDAD: confirma algo que la persona acaba de pedir,
  // sin palabras de venta (ni «gratis»), para que Meta no la pase a Marketing.
  {
    key: "evento_gratis_confirmacion",
    title: "Evento gratuito: confirmación de inscripción",
    category: "UTILITY",
    body: "Hola {{nombre}}, quedaste inscrita en {{evento}} el {{fecha}}. Te mando el enlace para entrar por aquí antes de empezar.",
    example: { nombre: "Ana", evento: "«Reprograma tu mente»", fecha: "domingo 4 de octubre a las 9:30 a. m. (hora de Colombia)" },
  },
  {
    key: "evento_grabacion",
    title: "Evento: grabación o material",
    category: "UTILITY",
    body: "Hola {{nombre}}, aquí tienes {{evento}}: {{enlace}} Espero que te sirva mucho 💛",
    example: { nombre: "Ana", evento: "la grabación de la masterclass", enlace: "https://www.dayanabeltran.com/eventos-gratuitos" },
  },
  {
    key: "enlace_de_pago",
    title: "Enlace de pago",
    category: "UTILITY",
    body: "Hola {{nombre}}, aquí tienes el enlace para pagar {{paquete}}: {{enlace}} Cualquier duda me escribes por aquí.",
    example: { nombre: "Ana", paquete: "el paquete de 3 sesiones", enlace: "https://www.dayanabeltran.com/pagar/terapias" },
  },
  {
    key: "taller_invitacion",
    title: "Taller: invitación",
    replacedBy: RETIRED_TEMPLATES.taller_invitacion,
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Abrimos {{evento}}, el {{fecha}}. Toda la información y tu inscripción aquí: {{enlace}} ¡Me encantaría verte!",
    example: { nombre: "Ana", evento: "el taller Sanando a mi niña interior", fecha: "sábado 11 de octubre", enlace: "https://www.dayanabeltran.com/taller-virtual/sanando" },
  },
  {
    key: "taller_recordatorio",
    title: "Taller: recordatorio",
    replacedBy: RETIRED_TEMPLATES.taller_recordatorio,
    category: "UTILITY",
    body: "Hola {{nombre}}, te recuerdo que {{evento}} es el {{fecha}}. Ingresa aquí: {{enlace}} ¡Te espero!",
    example: { nombre: "Ana", evento: "tu taller", fecha: "mañana a las 9:00 a. m.", enlace: "https://www.dayanabeltran.com/taller-virtual/sanando" },
  },
  {
    key: "seguimiento_diagnostico",
    title: "Seguimiento del cuestionario",
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Vi tu cuestionario y me gustaría escucharte. ¿Te regalo una consulta gratis de 15 minutos? Responde este mensaje y la agendamos.",
    example: { nombre: "Ana" },
  },
  {
    key: "autoevaluacion_bienvenida",
    title: "Después de la autoevaluación",
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Gracias por hacer tu autoevaluación. {{mensaje}} Quedo atenta a tu respuesta por aquí.",
    example: {
      nombre: "Ana",
      mensaje: "Leí lo que compartiste y me gustaría escucharte. ¿Te regalo una consulta gratis de 15 minutos?",
    },
  },
  {
    key: "retomar_conversacion",
    title: "Retomar la conversación",
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Te escribo para retomar nuestra conversación. {{mensaje}} Quedo atenta a tu respuesta por aquí.",
    example: { nombre: "Ana", mensaje: "Quería saber cómo sigues." },
  },
  // Citas: de UTILIDAD (informativas, sin palabras de venta) para que Meta las
  // apruebe rápido y se cobren como utilidad.
  {
    key: "cita_confirmacion",
    title: "Cita: confirmación",
    category: "UTILITY",
    body: "Hola {{nombre}}, tu cita de {{servicio}} quedó para el {{fecha}} a las {{hora}}. Enlace de la videollamada: {{enlace}} Si necesitas cambiarla, escríbeme por aquí.",
    example: { nombre: "Ana", servicio: "consulta de 15 minutos", fecha: "jueves 2 de octubre", hora: "10:00 a. m.", enlace: "https://meet.google.com/abc-defg-hij" },
  },
  {
    key: "cita_recordatorio",
    title: "Cita: recordatorio 24 h",
    category: "UTILITY",
    body: "Hola {{nombre}}, te recuerdo tu cita de {{servicio}} mañana {{fecha}} a las {{hora}}. Enlace: {{enlace}} Responde SÍ para confirmar o escríbeme si necesitas cambiarla.",
    example: { nombre: "Ana", servicio: "sesión de terapia", fecha: "jueves 2 de octubre", hora: "10:00 a. m.", enlace: "https://meet.google.com/abc-defg-hij" },
  },
  {
    key: "cita_reprogramar",
    title: "Cita: reprogramar",
    category: "UTILITY",
    body: "Hola {{nombre}}, necesito mover tu cita de {{servicio}} del {{fecha}}. ¿Te sirve otro horario? Responde por aquí y lo acomodamos.",
    example: { nombre: "Ana", servicio: "sesión de terapia", fecha: "jueves 2 de octubre" },
  },
  {
    key: "comunidad_invitacion",
    title: "Comunidad: invitación",
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Te invito a unirte a {{comunidad}}. Entra con este enlace: {{enlace}} ¡Te espero!",
    example: { nombre: "Ana", comunidad: "la comunidad Mujeres que sanan", enlace: "https://chat.whatsapp.com/AbCdEfGhIjK" },
  },
  {
    key: "comunidad_anuncio",
    title: "Comunidad: anuncio",
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Novedad en {{comunidad}}: {{mensaje}} Un abrazo.",
    example: { nombre: "Ana", comunidad: "la comunidad Mujeres que sanan", mensaje: "El jueves tenemos meditación en vivo a las 7 p. m." },
  },
];

export { toMetaBody };

/** Nombre válido para Meta: minúsculas, números y guion bajo. */
export { templateBodyProblem, utilityCategoryWarning } from "./whatsapp-template-rules";
import { templateBodyProblem } from "./whatsapp-template-rules";

export const metaTemplateName = (key: string): string =>
  key
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

export type RemoteTemplate = {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejected_reason?: string;
  /** La cabecera trae `format`: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION. */
  components?: { type?: string; text?: string; format?: string }[];
};

/**
 * Formato de la cabecera de una plantilla de 360dialog (`IMAGE`, `TEXT`…), o
 * `null` si no tiene cabecera. Una cabecera sin `format` es de texto.
 */
export const headerFormatOf = (t: RemoteTemplate): string | null => {
  const header = t.components?.find((c) => c.type?.toUpperCase() === "HEADER");
  return header ? (header.format ?? "TEXT").toUpperCase() : null;
};

const fetchRemoteTemplates = async (init: RequestInit = {}): Promise<RemoteTemplate[]> => {
  const data = (await dialog360Request("v1/configs/templates?limit=200", init)) as {
    waba_templates?: RemoteTemplate[];
    data?: RemoteTemplate[];
  };
  return data.waba_templates ?? data.data ?? [];
};

/**
 * La cabecera de la plantilla tal como está ahora en 360dialog (la aprobada,
 * si hay varias con ese nombre e idioma). La base no la guarda —sería una
 * migración—, así que se pregunta al empezar cada envío masivo.
 * `null`: sin cabecera; `undefined`: no está en 360dialog. Lanza si 360dialog
 * no responde (10 s como mucho).
 */
export const remoteTemplateHeaderFormat = async (
  name: string,
  language: string
): Promise<string | null | undefined> => {
  const remote = await fetchRemoteTemplates({ signal: AbortSignal.timeout(10_000) });
  const matches = remote.filter((t) => t.name === name && (t.language ?? "es") === language);
  const chosen = matches.find((t) => t.status?.toUpperCase() === "APPROVED") ?? matches[0];
  return chosen ? headerFormatOf(chosen) : undefined;
};

/** "REJECTED · INVALID_FORMAT": el motivo de Meta queda a la vista. */
const remoteStatus = (t: RemoteTemplate): string | null =>
  t.status
    ? t.status.toUpperCase() === "REJECTED" && t.rejected_reason && t.rejected_reason !== "NONE"
      ? `REJECTED · ${t.rejected_reason}`.slice(0, 120)
      : t.status.toUpperCase()
    : null;

const remoteBody = (t: Pick<RemoteTemplate, "components">) =>
  t.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? null;

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** La recomendada que se llama como esa plantilla de Meta, si hay. */
const starterNamed = (name: string) => STARTER_TEMPLATES.find((s) => metaTemplateName(s.key) === name) ?? null;

/**
 * La recomendada a la que se liga una plantilla creada en el Hub (la de
 * imagen), con sus variables en su orden ({{1}} = la primera de su cuerpo…).
 * Solo si se llama igual, está en español y su cuerpo es el de la
 * recomendada ya en {{1}}… (espacios aparte): con otro cuerpo, las variables
 * irían en otro orden. `null` si no.
 */
export const starterLinkForRemote = (
  t: Pick<RemoteTemplate, "name" | "language" | "components">
): { key: string; title: string; body: string; metaVarNames: string[] } | null => {
  const starter = t.name ? starterNamed(t.name) : null;
  const body = remoteBody(t);
  if (!starter || (t.language ?? "es") !== "es" || !body) return null;
  const meta = toMetaBody(starter.body);
  if (!sameText(body, meta.text)) return null;
  return { key: starter.key, title: starter.title, body: starter.body, metaVarNames: meta.varNames };
};

/**
 * Trae de 360dialog todas las plantillas y actualiza su estado en el CRM. Las
 * que se crearon fuera del CRM también aparecen: con la clave de la
 * recomendada si se llaman igual que una, si no con su nombre como clave.
 */
export const syncWhatsAppTemplates = async (): Promise<number> => {
  // Una plantilla con cabecera (IMAGE…) entra igual: de ella se guarda el cuerpo.
  const remote = await fetchRemoteTemplates();
  let count = 0;
  for (const t of remote) {
    if (!t.name) continue;
    const lang = t.language ?? "es";
    const existing = await prisma.messageTemplate.findFirst({
      where: { metaTemplateName: t.name, metaTemplateLang: lang },
    });
    const body = remoteBody(t);
    const link = starterLinkForRemote(t);
    if (existing && (!link || existing.key === link.key)) {
      await prisma.messageTemplate.update({
        where: { id: existing.id },
        data: {
          metaApprovalStatus: remoteStatus(t),
          metaCategory: t.category ?? null,
          ...(body ? { metaBody: body } : {}),
        },
      });
    } else if (link) {
      // Creada en el Hub con el nombre de una recomendada (la de imagen): se
      // liga a su clave con sus variables en el orden de la recomendada, así
      // los envíos la llenan por nombre (con `wa_…` y var1… no se podría).
      const remoteFields = {
        metaTemplateName: t.name,
        metaTemplateLang: lang,
        metaApprovalStatus: remoteStatus(t),
        metaCategory: t.category ?? null,
        metaBody: body,
        metaVarNames: link.metaVarNames,
      };
      await prisma.messageTemplate.upsert({
        where: { key_locale: { key: link.key, locale: "es" } },
        create: { key: link.key, title: link.title, locale: "es", body: link.body, ...remoteFields },
        update: { body: link.body, ...remoteFields },
      });
    } else {
      if (starterNamed(t.name)) {
        console.warn(
          `[whatsapp-templates] «${t.name}» (${lang}) se llama como una recomendada pero su cuerpo no es el de ella: queda como wa_${t.name}, sin ligar.`
        );
      }
      // Plantilla creada en el Hub: queda disponible con su nombre como clave.
      const numbered = body ?? "";
      const vars = [...numbered.matchAll(/\{\{(\d+)\}\}/g)].map((m) => `var${m[1]}`);
      await prisma.messageTemplate.upsert({
        where: { key_locale: { key: `wa_${t.name}`, locale: "es" } },
        create: {
          key: `wa_${t.name}`,
          title: t.name,
          locale: "es",
          body: numbered,
          metaTemplateName: t.name,
          metaTemplateLang: lang,
          metaApprovalStatus: remoteStatus(t),
          metaCategory: t.category ?? null,
          metaBody: body,
          metaVarNames: [...new Set(vars)],
        },
        update: {
          metaTemplateName: t.name,
          metaTemplateLang: lang,
          metaApprovalStatus: remoteStatus(t),
          metaCategory: t.category ?? null,
          metaBody: body,
        },
      });
    }
    count++;
  }
  return count;
};

/** Crea la plantilla en WhatsApp (360dialog → Meta la revisa) y la liga a su clave del CRM. */
export const createWhatsAppTemplate = async (input: {
  key: string;
  title: string;
  category: TemplateCategory;
  body: string;
  example: Record<string, string>;
}): Promise<{ name: string; status: string }> => {
  const problem = templateBodyProblem(input.body);
  if (problem) throw new Dialog360Error(problem, 400);
  const { text, varNames } = toMetaBody(input.body);
  const name = metaTemplateName(input.key);
  const examples = varNames.map((v) => input.example[v] || v);
  const response = (await dialog360Request("v1/configs/templates", {
    method: "POST",
    body: JSON.stringify({
      name,
      language: "es",
      category: input.category,
      components: [
        {
          type: "BODY",
          text,
          ...(varNames.length ? { example: { body_text: [examples] } } : {}),
        },
      ],
    }),
  })) as { status?: string };
  const status = (response.status ?? "PENDING").toUpperCase();
  await prisma.messageTemplate.upsert({
    where: { key_locale: { key: input.key, locale: "es" } },
    create: {
      key: input.key,
      title: input.title,
      locale: "es",
      body: input.body,
      metaTemplateName: name,
      metaTemplateLang: "es",
      metaApprovalStatus: status,
      metaCategory: input.category,
      metaBody: text,
      metaVarNames: varNames,
    },
    update: {
      title: input.title,
      body: input.body,
      metaTemplateName: name,
      metaTemplateLang: "es",
      metaApprovalStatus: status,
      metaCategory: input.category,
      metaBody: text,
      metaVarNames: varNames,
    },
  });
  return { name, status };
};

export type WaTemplate = {
  id: string;
  key: string;
  title: string;
  body: string;
  metaTemplateName: string | null;
  metaTemplateLang: string | null;
  metaApprovalStatus: string | null;
  metaCategory: string | null;
  metaBody: string | null;
  metaVarNames: string[];
};

/** Estado en Meta de la plantilla de esa clave (`APPROVED`, `PENDING`…), o null si nunca se mandó. */
export const getWhatsAppTemplateStatus = async (key: string): Promise<string | null> =>
  (
    await prisma.messageTemplate.findFirst({
      where: { key, metaTemplateName: { not: null } },
      select: { metaApprovalStatus: true },
    })
  )?.metaApprovalStatus ?? null;

export const listWhatsAppTemplates = (): Promise<WaTemplate[]> =>
  prisma.messageTemplate.findMany({
    where: { metaTemplateName: { not: null } },
    orderBy: { title: "asc" },
    select: {
      id: true,
      key: true,
      title: true,
      body: true,
      metaTemplateName: true,
      metaTemplateLang: true,
      metaApprovalStatus: true,
      metaCategory: true,
      metaBody: true,
      metaVarNames: true,
    },
  });

/** La plantilla aprobada ligada a una clave del CRM, si hay. */
export const approvedTemplateFor = async (key: string | null | undefined): Promise<WaTemplate | null> => {
  if (!key) return null;
  const t = await prisma.messageTemplate.findFirst({
    where: { key, metaApprovalStatus: "APPROVED", metaTemplateName: { not: null } },
    select: {
      id: true,
      key: true,
      title: true,
      body: true,
      metaTemplateName: true,
      metaTemplateLang: true,
      metaApprovalStatus: true,
      metaCategory: true,
      metaBody: true,
      metaVarNames: true,
    },
  });
  return t;
};

// ── Precios (los pone Dayana, del Hub de 360dialog) ────────────────────────

const PRICE_KEY = "whatsapp.templatePrices";

export type TemplatePrices = { currency: string; MARKETING: number; UTILITY: number };

export const getTemplatePrices = async (): Promise<TemplatePrices> => {
  try {
    const raw = await getSiteSetting(PRICE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<TemplatePrices>) : {};
    return {
      currency: parsed.currency || "USD",
      MARKETING: Number(parsed.MARKETING) || 0,
      UTILITY: Number(parsed.UTILITY) || 0,
    };
  } catch {
    return { currency: "USD", MARKETING: 0, UTILITY: 0 };
  }
};

export const setTemplatePrices = (prices: TemplatePrices) =>
  setSiteSetting(PRICE_KEY, JSON.stringify(prices));

export const priceFor = (prices: TemplatePrices, category: string | null | undefined): number =>
  category === "MARKETING" ? prices.MARKETING : category === "UTILITY" ? prices.UTILITY : prices.MARKETING;

// ── Mandarlas solas a aprobar ──────────────────────────────────────────────

const AUTO_SUBMIT_KEY = "whatsapp.templates.autoSubmitAt";

/**
 * Si una plantilla que el CRM necesita nunca se mandó a aprobar (o Meta la
 * rechazó), la manda sola desde las recomendadas. Como mucho una vez cada
 * 30 minutos, para no insistirle a 360dialog en cada envío. Mandarla a
 * revisión no cuesta; lo que se cobra es cada mensaje enviado con ella.
 */
export const ensureTemplatesSubmitted = async (
  keys: string[]
): Promise<{ submitted: string[]; failed: { key: string; error: string }[] }> => {
  const result = { submitted: [] as string[], failed: [] as { key: string; error: string }[] };
  // Nunca solas: las retiradas (ya tienen reemplazo) ni las de imagen (se
  // crean a mano en el Hub).
  const wanted = keys.filter((key) => {
    const starter = STARTER_TEMPLATES.find((t) => t.key === key);
    return !starter?.manual && !starter?.replacedBy;
  });
  if (wanted.length === 0) return result;
  const last = Number((await getSiteSetting(AUTO_SUBMIT_KEY)) ?? 0);
  if (Date.now() - last < 30 * 60_000) return result;
  const existing = await prisma.messageTemplate.findMany({
    where: { key: { in: wanted }, metaTemplateName: { not: null } },
    select: { key: true, metaApprovalStatus: true },
  });
  const missing = wanted.filter((key) => {
    const t = existing.find((e) => e.key === key);
    return !t || (t.metaApprovalStatus ?? "").toUpperCase().startsWith("REJECTED");
  });
  if (missing.length === 0) return result;
  await setSiteSetting(AUTO_SUBMIT_KEY, String(Date.now()));
  for (const key of missing) {
    const starter = STARTER_TEMPLATES.find((t) => t.key === key);
    if (!starter) continue;
    try {
      await createWhatsAppTemplate(starter);
      result.submitted.push(key);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[whatsapp-templates] no se pudo mandar a aprobar ${key}: ${error}`);
      result.failed.push({ key, error });
    }
  }
  if (result.submitted.length) console.log(`[whatsapp-templates] enviadas a revisión: ${result.submitted.join(", ")}`);
  return result;
};

/**
 * La plantilla del recordatorio de un evento (`preferredEventReminderTemplateKey`):
 * el de 24 h, `evento_acceso` si Meta la aprobó como UTILITY; el de 1 h (y
 * el de 24 h mientras tanto), `evento_inscrita_recordatorio` si Meta la
 * aprobó como UTILITY; si no, `evento_gratis_recordatorio`.
 *
 * Con `ensure` (el reloj de los eventos y los recordatorios) además la manda
 * sola a aprobar si nunca se mandó o Meta la rechazó (con el tope de una vez
 * cada 30 min de `ensureTemplatesSubmitted`) y pregunta a 360dialog si ya la
 * aprobaron. Así, tras el despliegue, nadie tiene que hacer nada.
 */
export const eventReminderTemplateKey = async (
  opts: { ensure?: boolean; pass?: "24h" | "1h" } = {}
): Promise<string> => {
  if (opts.ensure) await ensureEventTemplatesSubmitted();
  const rows = await prisma.messageTemplate.findMany({
    where: {
      key: { in: [EVENT_ACCESS_TEMPLATE_KEY, EVENT_REMINDER_UTILITY_TEMPLATE_KEY, EVENT_REMINDER_FALLBACK_TEMPLATE_KEY] },
      metaTemplateName: { not: null },
    },
    select: { key: true, metaApprovalStatus: true, metaCategory: true },
  });
  return preferredEventReminderTemplateKey(rows, opts.pass);
};

/**
 * Manda solas a aprobar las plantillas de eventos y talleres que faltan
 * (`evento_inscrita_recordatorio`, `evento_acceso`, `evento_invitacion`), con
 * el tope de una vez cada 30 min, y pregunta si Meta ya las aprobó. Lo llaman
 * los recordatorios y, después de responder, abrir un evento o un taller.
 */
export const ensureEventTemplatesSubmitted = async (): Promise<void> => {
  await ensureTemplatesSubmitted(EVENT_TEMPLATE_KEYS_TO_ENSURE).catch(() => undefined);
  await refreshTemplatesIfPending().catch(() => undefined);
};

/** Cómo está cada plantilla en Meta (para ordenar los mensajes listos). */
export const listTemplateBilling = () =>
  prisma.messageTemplate.findMany({
    where: { metaTemplateName: { not: null } },
    select: { key: true, metaApprovalStatus: true, metaCategory: true },
  });

/** Plantilla ligada a la clave, aprobada y que Meta cobra como Utilidad. */
export const approvedUtilityTemplateFor = async (key: string): Promise<WaTemplate | null> => {
  const t = await approvedTemplateFor(key);
  return t && (t.metaCategory ?? "").toUpperCase() === "UTILITY" ? t : null;
};

/**
 * «Quitar de WhatsApp» (solo OWNER, a mano): borra de 360dialog una plantilla
 * retirada, y solo si las que la reemplazan ya están aprobadas. La fila queda
 * en el CRM como «DELETED» (así nadie la elige). 360dialog borra todos los
 * idiomas de ese nombre, y Meta no deja reutilizar el nombre por 30 días.
 */
export const deleteRetiredWhatsAppTemplate = async (key: string): Promise<{ name: string }> => {
  const starter = STARTER_TEMPLATES.find((t) => t.key === key);
  if (!starter?.replacedBy) throw new Dialog360Error("Solo se pueden quitar las plantillas reemplazadas.", 400);
  const [row, replacements] = await Promise.all([
    prisma.messageTemplate.findFirst({ where: { key, metaTemplateName: { not: null } } }),
    prisma.messageTemplate.findMany({
      where: { key: { in: starter.replacedBy }, metaTemplateName: { not: null } },
      select: { key: true, metaApprovalStatus: true, metaCategory: true },
    }),
  ]);
  // Las de recordatorio, aprobadas como UTILITY: si Meta las pasó a Marketing
  // el CRM sigue usando esta, y quitarla dejaría los recordatorios sin respaldo.
  if (!retiredTemplateRemovable(key, replacements)) {
    throw new Dialog360Error(
      `Todavía no está en uso la que la reemplaza (${starter.replacedBy.join(", ")}): tiene que estar aprobada, y como Utilidad si es un recordatorio.`,
      409
    );
  }
  if (!row?.metaTemplateName) throw new Dialog360Error("Esta plantilla no está en WhatsApp.", 404);
  await dialog360Request(`v1/configs/templates/${encodeURIComponent(row.metaTemplateName)}`, { method: "DELETE" });
  await prisma.messageTemplate.updateMany({
    where: { metaTemplateName: row.metaTemplateName },
    data: { metaApprovalStatus: "DELETED" },
  });
  return { name: row.metaTemplateName };
};

const SYNC_KEY = "whatsapp.templates.syncedAt";

/**
 * Mientras haya plantillas en revisión, pregunta a 360dialog si Meta ya las
 * aprobó (como mucho cada 10 minutos). Así, en cuanto las aprueban, los envíos
 * pendientes salen sin que nadie tenga que abrir «Plantillas».
 */
export const refreshTemplatesIfPending = async (): Promise<void> => {
  const pending = await prisma.messageTemplate.count({
    where: {
      metaTemplateName: { not: null },
      NOT: { metaApprovalStatus: { in: ["APPROVED", "approved", "DELETED"] } },
    },
  });
  if (pending === 0) return;
  const last = Number((await getSiteSetting(SYNC_KEY)) ?? 0);
  if (Date.now() - last < 10 * 60_000) return;
  await setSiteSetting(SYNC_KEY, String(Date.now()));
  await syncWhatsAppTemplates().catch((e) =>
    console.error(`[whatsapp-templates] no se pudo actualizar el estado: ${e instanceof Error ? e.message : e}`)
  );
};
