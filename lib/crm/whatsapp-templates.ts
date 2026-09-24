import { prisma } from "@/lib/db";
import { Dialog360Error, dialog360Request } from "@/lib/meta/whatsapp-provider";
import { getSiteSetting, setSiteSetting } from "./site-settings";

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
};

/** Las que conviene tener aprobadas desde el principio. Editables antes de enviarlas. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "evento_gratis_invitacion",
    title: "Evento gratuito: invitación",
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Te invito a {{evento}}, gratis, el {{fecha}}. Reserva tu lugar aquí: {{enlace}} ¡Te espero!",
    example: { nombre: "Ana", evento: "la masterclass Reprograma tu mente", fecha: "jueves 2 de octubre, 7:00 p. m.", enlace: "https://www.dayanabeltran.com/eventos-gratuitos" },
  },
  {
    key: "evento_gratis_recordatorio",
    title: "Evento gratuito: recordatorio",
    category: "UTILITY",
    body: "Hola {{nombre}}, te recuerdo que {{evento}} es el {{fecha}}. Entra aquí: {{enlace}} Nos vemos pronto 💛",
    example: { nombre: "Ana", evento: "la masterclass", fecha: "hoy a las 7:00 p. m.", enlace: "https://www.dayanabeltran.com/eventos-gratuitos" },
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
    category: "MARKETING",
    body: "Hola {{nombre}}, te bendigo 💛 Abrimos {{evento}}, el {{fecha}}. Toda la información y tu inscripción aquí: {{enlace}} ¡Me encantaría verte!",
    example: { nombre: "Ana", evento: "el taller Sanando a mi niña interior", fecha: "sábado 11 de octubre", enlace: "https://www.dayanabeltran.com/taller-virtual/sanando" },
  },
  {
    key: "taller_recordatorio",
    title: "Taller: recordatorio",
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
];

/** {{nombre}} {{evento}} → {{1}} {{2}} y la lista de nombres en orden. */
export const toMetaBody = (body: string): { text: string; varNames: string[] } => {
  const varNames: string[] = [];
  const text = body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, name: string) => {
    let index = varNames.indexOf(name);
    if (index === -1) {
      varNames.push(name);
      index = varNames.length - 1;
    }
    return `{{${index + 1}}}`;
  });
  return { text, varNames };
};

/** Nombre válido para Meta: minúsculas, números y guion bajo. */
/**
 * Las reglas de Meta que más rechazos causan, revisadas antes de enviar: no
 * empezar ni terminar con una variable, ni dos variables seguidas.
 */
export const templateBodyProblem = (body: string): string | null => {
  const t = body.trim();
  if (/^\{\{\w+\}\}/.test(t)) return "No puede empezar con una variable: pon un saludo antes.";
  if (/\{\{\w+\}\}[\s.!?¡¿:,;]*$/.test(t))
    return "No puede terminar con una variable (por ejemplo el enlace): agrega una frase después.";
  if (/\}\}\s*\{\{/.test(t)) return "No puede tener dos variables seguidas: pon texto entre ellas.";
  if (t.length > 1024) return "Es demasiado larga (máximo 1024 caracteres).";
  return null;
};

export const metaTemplateName = (key: string): string =>
  key
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

type RemoteTemplate = {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejected_reason?: string;
  components?: { type?: string; text?: string }[];
};

/** "REJECTED · INVALID_FORMAT": el motivo de Meta queda a la vista. */
const remoteStatus = (t: RemoteTemplate): string | null =>
  t.status
    ? t.status.toUpperCase() === "REJECTED" && t.rejected_reason && t.rejected_reason !== "NONE"
      ? `REJECTED · ${t.rejected_reason}`.slice(0, 120)
      : t.status.toUpperCase()
    : null;

const remoteBody = (t: RemoteTemplate) =>
  t.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? null;

/**
 * Trae de 360dialog todas las plantillas y actualiza su estado en el CRM. Las
 * que se crearon fuera del CRM también aparecen (con su nombre como clave).
 */
export const syncWhatsAppTemplates = async (): Promise<number> => {
  const data = (await dialog360Request("v1/configs/templates?limit=200")) as {
    waba_templates?: RemoteTemplate[];
    data?: RemoteTemplate[];
  };
  const remote = data.waba_templates ?? data.data ?? [];
  let count = 0;
  for (const t of remote) {
    if (!t.name) continue;
    const lang = t.language ?? "es";
    const existing = await prisma.messageTemplate.findFirst({
      where: { metaTemplateName: t.name, metaTemplateLang: lang },
    });
    const body = remoteBody(t);
    if (existing) {
      await prisma.messageTemplate.update({
        where: { id: existing.id },
        data: {
          metaApprovalStatus: remoteStatus(t),
          metaCategory: t.category ?? null,
          ...(body ? { metaBody: body } : {}),
        },
      });
    } else {
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
  const status = response.status ?? "PENDING";
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
