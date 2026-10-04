import { getSiteUrl } from "@/lib/site-url";
import {
  EVENT_ACCESS_TEMPLATE_KEY,
  EVENT_INVITATION_IMAGE_TEMPLATE_KEY,
  EVENT_INVITATION_TEMPLATE_KEY,
  EVENT_REMINDER_FALLBACK_TEMPLATE_KEY,
  isTemplateApproved,
  RETIRED_TEMPLATES,
  templateInUse,
  type TemplateBilling,
} from "./event-reminder-template";
import {
  EVENT_ACCESS_BODY,
  EVENT_INVITATION_BODY,
  eventTemplateVars,
  fillKnownVars,
  sanitizeMensaje,
} from "./event-template-vars";

/**
 * Mensajes listos para enviar por WhatsApp desde cada pantalla del CRM. Cada
 * uno trae el texto libre (para quien escribió en las últimas 24 h) y la
 * plantilla que se usa con el resto. `{{texto}}` en una variable se reemplaza
 * por lo que se escribió en la caja (para el mensaje libre por plantilla).
 */

export type Preset = {
  id: string;
  label: string;
  text: string;
  templateKey?: string | null;
  vars?: Record<string, string>;
  /**
   * Su plantilla lleva imagen arriba: solo el envío masivo (que sube la
   * imagen) la ofrece, y solo cuando Meta ya la aprobó.
   */
  imageTemplate?: boolean;
  /**
   * El mensaje de antes al que reemplaza (`recordatorio`, `invitacion`):
   * mientras su plantilla no esté en uso, va detrás de él (no es el de por
   * defecto).
   */
  replaces?: string;
};

/**
 * Los mensajes según cómo está cada plantilla en Meta (`approvals`; sin él,
 * tal cual):
 * - uno con plantilla retirada que ya no está aprobada (en revisión,
 *   rechazada o quitada de WhatsApp) no se ofrece;
 * - uno nuevo cuya plantilla aún no está en uso (`evento_acceso` aprobada
 *   como UTILITY, la invitación aprobada) va detrás del de antes, así el de
 *   por defecto sigue siendo el que llega a todas.
 */
export const arrangePresets = (presets: Preset[], approvals?: TemplateBilling[]): Preset[] => {
  if (!approvals) return presets;
  const offered = presets.filter(
    (p) =>
      !(
        p.templateKey &&
        RETIRED_TEMPLATES[p.templateKey] &&
        !isTemplateApproved(approvals.find((t) => t.key === p.templateKey))
      )
  );
  const waiting = offered.filter(
    (p) =>
      p.replaces &&
      p.templateKey &&
      !templateInUse(p.templateKey, approvals) &&
      offered.some((o) => o.id === p.replaces)
  );
  const out = offered.filter((p) => !waiting.includes(p));
  for (const id of [...new Set(waiting.map((p) => p.replaces!))]) {
    const at = out.findIndex((p) => p.id === id);
    out.splice(at + 1, 0, ...waiting.filter((p) => p.replaces === id));
  }
  return out;
};

export const TEXT_SLOT = "{{texto}}";

/**
 * En una variable: lo escrito en «Tu mensaje» (una línea, hasta 300). Lo
 * llena el envío; en el texto libre queda {{mensaje}} y se llena igual.
 */
export const MESSAGE_SLOT = "{{tu_mensaje}}";

/** El mensaje pide «Tu mensaje» (la invitación con horarios). */
export const presetNeedsMessage = (preset: Pick<Preset, "vars"> | null | undefined): boolean =>
  Boolean(preset?.vars && Object.values(preset.vars).includes(MESSAGE_SLOT));

/**
 * En una variable: el primer enlace escrito en la caja. Para lo que el CRM no
 * guarda —la grabación de un evento que ya pasó— y solo puede pegar quien
 * envía.
 */
export const LINK_SLOT = "{{enlace_del_texto}}";

const firstUrl = (text: string): string =>
  text.match(/https?:\/\/\S+/)?.[0].replace(/[.,;:!?)»"']+$/, "") ?? "";

/**
 * «domingo 4 de octubre a las 9:30 a. m.». Empieza por el día de la semana
 * porque las plantillas dicen «es el {{fecha}}» y «el {{fecha}}». Sin los
 * espacios duros de Intl (`\s` los cubre), que cambian según la versión de ICU.
 */
export const eventDateText = (d: Date | null, hasTime: boolean, tz: string): string => {
  if (!d) return "próximamente";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })
      .formatToParts(d)
      .map((part) => [part.type, part.value])
  );
  const day = `${p.weekday} ${p.day} de ${p.month}`;
  if (!hasTime) return day;
  const hour = new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    .format(d)
    .replace(/\s/g, " ");
  return `${day} ${hour.startsWith("1:") ? "a la" : "a las"} ${hour}`;
};

// Las plantillas ponen punto justo después de {{fecha}} («es el {{fecha}}.
// Entra aquí»): con «a. m.» quedaba «a. m.. Entra». El punto de la abreviatura
// se funde con el de la frase.
const beforePeriod = (s: string) => s.replace(/\.$/, "");

/** Lo que los mensajes necesitan de un evento gratuito. */
export type FreeEventPresetEvent = {
  /** Con él, la descarga del material es la de ESTE evento. */
  id?: string;
  headline: string;
  startsAt: Date | null;
  startsAtHasTime: boolean;
  /** Enlace de la reunión; sin él, el recordatorio manda a la landing. */
  meetUrl?: string | null;
  /** `/api/webinar/material` lo sirve ahora (`isFreeEventMaterialDownloadable`). */
  materialDownloadable?: boolean;
  /** Para enlazar su página (`/eventos-gratuitos/<slug>`); sin él, la landing. */
  slug?: string | null;
};

type ScheduleSource = Parameters<typeof eventTemplateVars>[0];

/**
 * Acceso con horarios, a quien se inscribió o pagó (`evento_acceso`). El
 * texto libre ya viene lleno, con el horario de cada país; solo {{nombre}}
 * se llena al enviar.
 */
const accessPreset = (source: ScheduleSource): Preset => {
  const vars = eventTemplateVars(source, { for: "inscrita" });
  return {
    id: "acceso",
    label: "Acceso con horarios (inscritas)",
    text: fillKnownVars(EVENT_ACCESS_BODY, vars),
    templateKey: EVENT_ACCESS_TEMPLATE_KEY,
    vars,
    replaces: "recordatorio",
  };
};

/**
 * Invitación con horarios (`evento_invitacion`) y, si Meta ya aprobó la
 * creada a mano en el Hub, la misma con imagen arriba. {{mensaje}} es lo que
 * Dayana escribe en «Tu mensaje».
 */
const invitationPresets = (source: ScheduleSource): Preset[] => {
  const vars = eventTemplateVars(source, { for: "invitacion" });
  const text = fillKnownVars(EVENT_INVITATION_BODY, vars);
  return [
    {
      id: "invitacion_horarios",
      label: "Invitación con horarios",
      text,
      templateKey: EVENT_INVITATION_TEMPLATE_KEY,
      vars: { ...vars, mensaje: MESSAGE_SLOT },
      replaces: "invitacion",
    },
    {
      id: "invitacion_imagen",
      label: "Invitación con imagen y horarios",
      text,
      templateKey: EVENT_INVITATION_IMAGE_TEMPLATE_KEY,
      vars: { ...vars, mensaje: MESSAGE_SLOT },
      imageTemplate: true,
      replaces: "invitacion",
    },
  ];
};

// Las plantillas ya ponen el artículo y el «gratis»: con el tipo de evento
// delante se leía «te recuerdo que webinar gratuito «…» es el…».
const eventName = (e: FreeEventPresetEvent | null) =>
  e ? `«${e.headline.trim()}»` : "mi próximo evento gratuito";
const eventDate = (e: FreeEventPresetEvent | null, tz: string) =>
  beforePeriod(e ? eventDateText(e.startsAt, e.startsAtHasTime, tz) : "próximamente");
const landingUrl = () => `${getSiteUrl()}/eventos-gratuitos`;

/** Invitación: a la landing, que es donde se reserva el lugar. */
const freeEventInvitation = (event: FreeEventPresetEvent | null, tz: string, label = "Invitación"): Preset => {
  const evento = eventName(event);
  const fecha = eventDate(event, tz);
  const enlace = landingUrl();
  return {
    id: "invitacion",
    label,
    text: `Hola {{nombre}}, te bendigo 💛 Te invito a ${evento}, gratis, el ${fecha}. Reserva tu lugar aquí: ${enlace} ¡Te espero!`,
    templateKey: "evento_gratis_invitacion",
    vars: { evento, fecha, enlace },
  };
};

/**
 * Recordatorio: directo a la reunión; la landing solo si aún no hay enlace.
 * `templateKey`: la de utilidad (`evento_inscrita_recordatorio`) si Meta ya la
 * aprobó como UTILITY (`eventReminderTemplateKey`); si no, la de siempre.
 * Las dos llevan las mismas variables.
 */
const freeEventReminder = (
  event: FreeEventPresetEvent | null,
  tz: string,
  templateKey: string = EVENT_REMINDER_FALLBACK_TEMPLATE_KEY
): Preset => {
  const evento = eventName(event);
  const fecha = eventDate(event, tz);
  const meet = event?.meetUrl?.trim() || null;
  const enlace = meet ?? landingUrl();
  return {
    id: "recordatorio",
    label: meet ? "Recordatorio con el enlace de Meet" : "Recordatorio (aún sin enlace de Meet)",
    text: `Hola {{nombre}}, te recuerdo que ${evento} es el ${fecha}. Entra aquí: ${enlace} Nos vemos pronto 💛`,
    templateKey,
    vars: { evento, fecha, enlace },
  };
};

/**
 * Material: la descarga de la web mientras la sirva; si no (evento pasado o
 * sin archivo) el enlace lo pega quien envía — mandar la descarga sería un 404.
 */
const freeEventMaterial = (event: FreeEventPresetEvent | null, label: string): Preset => {
  const evento = eventName(event);
  const download = event?.materialDownloadable
    ? `${getSiteUrl()}/api/webinar/material${event.id ? `?evento=${encodeURIComponent(event.id)}` : ""}`
    : null;
  return {
    id: "material",
    label,
    text: `Hola {{nombre}}, aquí tienes el material de ${evento}: ${download ?? ""}`,
    templateKey: "evento_grabacion",
    vars: { evento: `el material de ${evento}`, enlace: download ?? LINK_SLOT },
  };
};

/** Todos los mensajes de un evento (el agente elige por id). */
export const freeEventPresets = (
  event: FreeEventPresetEvent | null,
  tz: string,
  /** La plantilla del recordatorio (`eventReminderTemplateKey`). */
  reminderTemplateKey?: string
): Preset[] => [
  freeEventInvitation(event, tz),
  freeEventReminder(event, tz, reminderTemplateKey),
  freeEventMaterial(event, "Grabación o material"),
  genericPreset(),
];

/**
 * Los mensajes que tienen sentido según el evento que se mira:
 * - ninguno (todas las inscritas): invitarlas al evento abierto;
 * - el actual, sin cerrar: el recordatorio con el enlace de la reunión y el material;
 * - uno pasado: su material o grabación, e invitarlas al evento abierto.
 * El mensaje libre, siempre.
 */
export const freeEventPresetsFor = (
  input: {
    selected: FreeEventPresetEvent | null;
    /** El seleccionado es el actual y no se ha cerrado (`isFreeEventUpcoming`). */
    selectedUpcoming: boolean;
    /** El evento con inscripciones abiertas, si lo hay (`isFreeEventOpen`). */
    openEvent: FreeEventPresetEvent | null;
    /**
     * La plantilla del recordatorio (`eventReminderTemplateKey`): la de
     * utilidad si Meta ya la aprobó como UTILITY. Sin ella, la de siempre.
     */
    reminderTemplateKey?: string;
    /** Cómo está cada plantilla en Meta (`listTemplateBilling`), para `arrangePresets`. */
    approvals?: TemplateBilling[];
  },
  tz: string
): Preset[] => {
  const { selected, openEvent } = input;
  const invite = (label?: string) =>
    openEvent ? [...invitationPresets(openEvent), freeEventInvitation(openEvent, tz, label)] : [];
  if (!selected) return arrangePresets([...invite(), genericPreset()], input.approvals);
  if (input.selectedUpcoming) {
    return arrangePresets(
      [
        accessPreset(selected),
        freeEventReminder(selected, tz, input.reminderTemplateKey),
        freeEventMaterial(selected, "Material"),
        genericPreset(),
      ],
      input.approvals
    );
  }
  return arrangePresets(
    [freeEventMaterial(selected, "Material o grabación"), ...invite("Invitación al evento actual"), genericPreset()],
    input.approvals
  );
};

export const genericPreset = (): Preset => ({
  id: "libre",
  label: "Mensaje libre",
  text: "Hola {{nombre}}, te bendigo 💛 ",
  templateKey: "retomar_conversacion",
  vars: { mensaje: TEXT_SLOT },
});

export const contactPresets = (): Preset[] => [
  genericPreset(),
  {
    id: "consulta",
    label: "Consulta gratis",
    text: "Hola {{nombre}}, te bendigo 💛 ¿Te regalo una consulta gratis de 15 minutos con Dayana? Cuéntame qué día te queda mejor.",
    templateKey: "seguimiento_diagnostico",
  },
];

export const diagnosticPresets = (): Preset[] => [
  {
    id: "seguimiento",
    label: "Seguimiento del cuestionario",
    text: "Hola {{nombre}}, te bendigo 💛 Vi tu cuestionario y me gustaría escucharte. ¿Te regalo una consulta gratis de 15 minutos? Dime qué día te queda mejor.",
    templateKey: "seguimiento_diagnostico",
  },
  genericPreset(),
];

export const paymentLinkPresets = (input: { url: string; product: string }): Preset[] => [
  {
    id: "pago",
    label: "Enlace de pago",
    text: `Hola {{nombre}}, aquí tienes el enlace para pagar ${input.product}: ${input.url}`,
    templateKey: "enlace_de_pago",
    vars: { paquete: input.product, enlace: input.url },
  },
];

export const workshopPresets = (
  w: {
    title: string;
    slug: string;
    startsAt: Date | null;
    /** Sin él, se da por hecho que tiene hora. */
    startsAtHasTime?: boolean;
    dateLabel: string | null;
    meetingUrl: string | null;
    /** El precio vigente (`EditionPrices`), para la invitación con horarios. */
    prices?: { cop: number | null; usd: number | null } | null;
  },
  tz: string,
  /** Cómo está cada plantilla en Meta (`listTemplateBilling`), para `arrangePresets`. */
  approvals?: TemplateBilling[]
): Preset[] => {
  const site = getSiteUrl();
  const page = `${site}/taller-virtual/${w.slug}`;
  const fecha = beforePeriod(w.dateLabel || eventDateText(w.startsAt, true, tz));
  const entrar = w.meetingUrl || page;
  const schedule = { ...w, startsAtHasTime: w.startsAtHasTime ?? true };
  return arrangePresets([
    accessPreset(schedule),
    ...invitationPresets(schedule),
    {
      id: "invitacion",
      label: "Invitación",
      text: `Hola {{nombre}}, te bendigo 💛 Abrimos el taller «${w.title}», ${fecha}. Toda la información y tu inscripción aquí: ${page}`,
      templateKey: "taller_invitacion",
      vars: { evento: `el taller «${w.title}»`, fecha, enlace: page },
    },
    {
      id: "recordatorio",
      label: "Recordatorio con enlace",
      text: `Hola {{nombre}}, te recuerdo que el taller «${w.title}» es ${fecha}. Ingresa aquí: ${entrar}`,
      templateKey: "taller_recordatorio",
      vars: { evento: `tu taller «${w.title}»`, fecha, enlace: entrar },
    },
    genericPreset(),
  ], approvals);
};

/**
 * Pone lo escrito en la caja donde una variable pide `{{texto}}`, y el primer
 * enlace escrito donde pide `{{enlace_del_texto}}`.
 */
export const resolvePresetVars = (
  vars: Record<string, string> | undefined,
  text: string,
  /** Lo escrito en «Tu mensaje», donde una variable pide `{{tu_mensaje}}`. */
  mensaje?: string | null
): Record<string, string> | undefined => {
  if (!vars) return vars;
  const clean = text.replace(/\{\{\s*nombre\s*\}\}/g, "").replace(/^\s*hola\s*,?\s*/i, "").trim();
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [
      k,
      v === TEXT_SLOT ? clean : v === LINK_SLOT ? firstUrl(text) : v === MESSAGE_SLOT ? sanitizeMensaje(mensaje) : v,
    ])
  );
};

/** El mensaje necesita un enlace que solo puede pegar quien envía, y aún no está. */
export const presetMissingLink = (
  preset: Pick<Preset, "vars"> | null | undefined,
  text: string
): boolean => Boolean(preset?.vars && Object.values(preset.vars).includes(LINK_SLOT) && !firstUrl(text));

/** Invitar a una comunidad o grupo de WhatsApp: el enlace va 1 a 1. */
export const communityInvitePresets = (c: { name: string; inviteLink: string | null }): Preset[] => [
  {
    id: "invitacion",
    label: "Invitación con enlace",
    text: `Hola {{nombre}}, te bendigo 💛 Te invito a unirte a ${c.name}. Entra con este enlace: ${c.inviteLink ?? ""} ¡Te espero!`,
    templateKey: "comunidad_invitacion",
    vars: { comunidad: c.name, enlace: c.inviteLink ?? "" },
  },
];

/** Anuncio a quienes ya están en la comunidad, 1 a 1. */
export const communityAnnouncePresets = (c: { name: string }): Preset[] => [
  {
    id: "anuncio",
    label: "Anuncio",
    text: `Hola {{nombre}}, te bendigo 💛 Novedad en ${c.name}: `,
    templateKey: "comunidad_anuncio",
    vars: { comunidad: c.name, mensaje: TEXT_SLOT },
  },
];
