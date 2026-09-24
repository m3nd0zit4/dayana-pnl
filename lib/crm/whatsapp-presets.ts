import { getSiteUrl } from "@/lib/site-url";

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
};

export const TEXT_SLOT = "{{texto}}";

const when = (d: Date | null, hasTime: boolean, tz: string) =>
  d
    ? `${new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d)}${
        hasTime ? `, ${new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d)}` : ""
      }`
    : "próximamente";

export const freeEventPresets = (
  event: { headline: string; eventLabel: string; startsAt: Date | null; startsAtHasTime: boolean } | null,
  tz: string
): Preset[] => {
  const site = getSiteUrl();
  const link = `${site}/eventos-gratuitos`;
  const name = event ? `${event.eventLabel.toLowerCase()} «${event.headline}»` : "el evento gratuito";
  const fecha = event ? when(event.startsAt, event.startsAtHasTime, tz) : "próximamente";
  return [
    {
      id: "invitacion",
      label: "Enlace del evento",
      text: `Hola {{nombre}}, te bendigo 💛 Te comparto el enlace de ${name} (${fecha}): ${link}`,
      templateKey: "evento_gratis_invitacion",
      vars: { evento: name, fecha, enlace: link },
    },
    {
      id: "recordatorio",
      label: "Recordatorio",
      text: `Hola {{nombre}}, te recuerdo que ${name} es el ${fecha}. Entra aquí: ${link}`,
      templateKey: "evento_gratis_recordatorio",
      vars: { evento: name, fecha, enlace: link },
    },
    {
      id: "material",
      label: "Grabación o material",
      text: `Hola {{nombre}}, aquí tienes el material de ${name}: ${site}/api/webinar/material`,
      templateKey: "evento_grabacion",
      vars: { evento: `el material de ${name}`, enlace: `${site}/api/webinar/material` },
    },
    genericPreset(),
  ];
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
  w: { title: string; slug: string; startsAt: Date | null; dateLabel: string | null; meetingUrl: string | null },
  tz: string
): Preset[] => {
  const site = getSiteUrl();
  const page = `${site}/taller-virtual/${w.slug}`;
  const fecha = w.dateLabel || when(w.startsAt, true, tz);
  const entrar = w.meetingUrl || page;
  return [
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
  ];
};

/** Pone lo escrito en la caja donde una variable pide `{{texto}}`. */
export const resolvePresetVars = (
  vars: Record<string, string> | undefined,
  text: string
): Record<string, string> | undefined => {
  if (!vars) return vars;
  const clean = text.replace(/\{\{\s*nombre\s*\}\}/g, "").replace(/^\s*hola\s*,?\s*/i, "").trim();
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v === TEXT_SLOT ? clean : v]));
};
