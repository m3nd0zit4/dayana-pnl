/**
 * What the approval card says before Dayana taps «Aprobar»: the tool's name
 * and the few facts that matter, in Spanish, instead of a JSON dump of ids.
 *
 * Pure (tested in approval-summary.test.ts). The tool input only carries ids
 * (`contactId`, `enrollmentId`…), so the caller passes `names`: the labels it
 * already saw for those ids in earlier tool results of the same thread.
 */
import { AGENT_PROFILES, isAgentId, TOOL_CATALOG, toolLabel, type ToolAccess } from "@/agent/lib/catalog";
import { formatMoneyMinor } from "@/lib/crm/money";

export type ApprovalLine = { label: string; value: string };

export type ApprovalSummary = {
  /** Card title: the tool's catalog label. */
  title: string;
  access: ToolAccess;
  /** Who receives it / who is affected. Always set for execute-level tools. */
  recipient?: string;
  lines: ApprovalLine[];
  /** One sentence of consequence («Lo ve todo el mundo en la web»). */
  note?: string;
};

export type SummaryContext = { names?: Readonly<Record<string, string>> };

type Input = Record<string, unknown>;

const MAX_TEXT = 220;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const truncate = (text: string, max = MAX_TEXT): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** cuid / cuid2 / uuid / long opaque tokens: meaningless to a person. */
export const looksLikeId = (value: string): boolean =>
  /^c[a-z0-9]{20,32}$/.test(value) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
  /^[A-Za-z0-9_-]{24,}$/.test(value);

const nameFor = (ctx: SummaryContext, id: unknown, fallback: string): string => {
  const key = str(id);
  if (!key) return fallback;
  return ctx.names?.[key] ?? fallback;
};

const plainNumber = (value: number): string => value.toLocaleString("es-CO", { maximumFractionDigits: 2 });

const usdWhole = (value: number) =>
  `${value.toLocaleString("es-CO", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })} USD`;

const copWhole = (value: number) => `${Math.round(value).toLocaleString("es-CO")} COP`;

const DATE_PARTS = (timeZone: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone });

const TIME_FMT = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });

/** «10 nov 2026» — es-CO's own short form is «10 de nov de 2026», too long for a card line. */
const shortDate = (date: Date, timeZone: string): string => {
  const parts = DATE_PARTS(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month").replace(/\.$/, "")} ${get("year")}`.trim();
};

/** Times in Colombia, the CRM's operating zone. */
const formatDateTime = (iso: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return shortDate(new Date(`${iso}T12:00:00Z`), "UTC");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${shortDate(date, "America/Bogota")}, ${TIME_FMT.format(date)}`;
};

const formatRange = (startIso: string, endIso: string | undefined): string => {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  if (Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) return formatDateTime(startIso);
  const sameDay = shortDate(start, "America/Bogota") === shortDate(end, "America/Bogota");
  return sameDay
    ? `${formatDateTime(startIso)} – ${TIME_FMT.format(end)}`
    : `${formatDateTime(startIso)} – ${formatDateTime(endIso!)}`;
};

const yesNo = (value: boolean) => (value ? "Sí" : "No");

const push = (lines: ApprovalLine[], label: string, value: string | undefined) => {
  if (value) lines.push({ label, value });
};

const accessOf = (toolName: string): ToolAccess =>
  (TOOL_CATALOG as Record<string, { access: ToolAccess }>)[toolName]?.access ?? "edit";

// ── generic fallback ────────────────────────────────────────────────────────

const KEY_LABELS: Record<string, string> = {
  name: "Nombre",
  displayName: "Nombre",
  firstName: "Nombre",
  lastName: "Apellido",
  title: "Título",
  headline: "Título",
  summary: "Resumen",
  description: "Descripción",
  email: "Correo",
  phone: "Teléfono",
  text: "Mensaje",
  body: "Mensaje",
  message: "Mensaje",
  subject: "Asunto",
  content: "Contenido",
  notes: "Notas",
  status: "Estado",
  amount: "Monto",
  currency: "Moneda",
  code: "Código",
  reference: "Referencia",
  role: "Rol",
  mode: "Modo",
  isActive: "Activo",
  enabled: "Encendido",
  capacity: "Cupo",
  dateLabel: "Fecha",
  scheduleLabel: "Horario",
  startsAtDate: "Fecha",
  startsAtTime: "Hora",
  startIso: "Inicio",
  endIso: "Fin",
  meetUrl: "Enlace de Meet",
  templateKey: "Plantilla",
  audience: "Para",
  url: "Enlace",
  slug: "Taller",
};

const humanizeKey = (key: string): string => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const isIdKey = (key: string) => key === "id" || /Ids?$/.test(key) || /^id[A-Z]/.test(key);

const primitiveValue = (key: string, value: unknown): string | undefined => {
  if (typeof value === "boolean") return yesNo(value);
  if (typeof value === "number") return Number.isFinite(value) ? plainNumber(value) : undefined;
  if (typeof value === "string") {
    const v = value.trim();
    if (!v || looksLikeId(v)) return undefined;
    if (/Iso$|At$/.test(key) && !Number.isNaN(Date.parse(v))) return formatDateTime(v);
    return truncate(v);
  }
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" || typeof v === "number")) {
    const shown = value.slice(0, 5).map(String).filter((v) => !looksLikeId(v));
    if (shown.length === 0) return `${value.length} elementos`;
    const rest = value.length - shown.length;
    return truncate(rest > 0 ? `${shown.join(", ")} y ${rest} más` : shown.join(", "));
  }
  return undefined;
};

/** Every top-level primitive field, ids and cuid-looking values left out. */
export const genericLines = (input: unknown, limit = 6): ApprovalLine[] => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const lines: ApprovalLine[] = [];
  for (const [key, value] of Object.entries(input as Input)) {
    if (isIdKey(key)) continue;
    const text = primitiveValue(key, value);
    if (text) lines.push({ label: KEY_LABELS[key] ?? humanizeKey(key), value: text });
    if (lines.length >= limit) break;
  }
  return lines;
};

// ── specific summaries ──────────────────────────────────────────────────────

type Summarizer = (input: Input, ctx: SummaryContext) => Omit<ApprovalSummary, "title" | "access">;

const CONTACT = "el contacto elegido";

const STAFF_ROLES: Record<string, string> = {
  OWNER: "Dueña",
  OPERATOR: "Operadora",
  READONLY: "Solo lectura",
  DEVELOPER: "Desarrollo",
};

const CHAT_MODES: Record<string, string> = {
  AUTO: "Responde la IA",
  COPILOT: "La IA sugiere y tú apruebas",
  MANUAL: "Responde Dayana",
};

const BULK_MESSAGES: Record<string, string> = {
  enlace: "Enlace de la reunión",
  recordatorio: "Recordatorio",
  material: "Material",
  invitacion: "Invitación",
  libre: "Mensaje propio",
};

const WORKSHOP_STATUS: Record<string, string> = {
  DRAFT: "Borrador",
  OPEN: "Inscripciones abiertas",
  CLOSED: "Inscripciones cerradas",
  COMPLETED: "Terminado",
};

const discountText = (input: Input): string | undefined => {
  const percent = num(input.percentOff);
  if (percent) return `${percent} %`;
  const parts: string[] = [];
  const usd = num(input.amountOffUsdMinor);
  const cop = num(input.amountOffCopMinor);
  if (usd) parts.push(`${formatMoneyMinor(usd, "USD")} USD`);
  if (cop) parts.push(`${formatMoneyMinor(cop, "COP")} COP`);
  return parts.length ? parts.join(" o ") : undefined;
};

const promoSummary: Summarizer = (input) => {
  const lines: ApprovalLine[] = [];
  push(lines, "Código", str(input.code));
  push(lines, "Descuento", discountText(input));
  push(lines, "Usos máximos", num(input.maxRedemptions)?.toString());
  push(lines, "Vence", str(input.expiresAt) && formatDateTime(str(input.expiresAt)!));
  if (typeof input.isActive === "boolean") push(lines, "Activo", yesNo(input.isActive));
  push(lines, "Descripción", str(input.description) && truncate(str(input.description)!));
  return { lines };
};

const workshopSummary: Summarizer = (input) => {
  const lines: ApprovalLine[] = [];
  push(lines, "Título", str(input.title));
  push(lines, "Estado", str(input.status) && (WORKSHOP_STATUS[str(input.status)!] ?? str(input.status)));
  push(lines, "Fecha", str(input.dateLabel));
  push(lines, "Horario", str(input.scheduleLabel));
  const capacity = num(input.capacity);
  if (capacity !== undefined) push(lines, "Cupo", capacity === 0 ? "Sin límite" : plainNumber(capacity));
  const cop = num(input.priceCop);
  const usd = num(input.priceUsd);
  if (cop !== undefined) push(lines, "Precio COP", copWhole(cop));
  if (usd !== undefined) push(lines, "Precio USD", usdWhole(usd));
  return {
    lines,
    note: input.status === "OPEN" ? "Abrirlo cierra cualquier otro taller abierto." : undefined,
  };
};

const calendarSummary: Summarizer = (input) => {
  const lines: ApprovalLine[] = [];
  push(lines, "Evento", str(input.summary));
  const start = str(input.startIso);
  const end = str(input.endIso);
  if (start) push(lines, "Cuándo", formatRange(start, end));
  push(lines, "Lugar", str(input.location));
  const guests = Array.isArray(input.attendeeEmails) ? input.attendeeEmails.filter((e) => typeof e === "string") : [];
  if (guests.length) push(lines, "Invitados", truncate(guests.join(", ")));
  if (input.withMeet === true) push(lines, "Google Meet", "Sí");
  return {
    lines,
    recipient: guests.length ? `${guests.length === 1 ? "1 invitado" : `${guests.length} invitados`} por correo` : undefined,
    note: guests.length ? "Google les manda la invitación." : undefined,
  };
};

const SUMMARIZERS: Record<string, Summarizer> = {
  send_whatsapp_to_contact: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Mensaje", str(input.text) && truncate(str(input.text)!));
    push(lines, "Plantilla", str(input.templateKey));
    return {
      recipient: str(input.conversationId)
        ? nameFor(ctx, input.conversationId, "el chat elegido")
        : nameFor(ctx, input.contactId, CONTACT),
      lines,
      note: str(input.templateKey)
        ? "Si pasaron 24 horas desde su último mensaje, sale como plantilla."
        : "Le llega por WhatsApp desde el número de Dayana.",
    };
  },

  send_whatsapp_bulk: (input, ctx) => {
    const ids = Array.isArray(input.contactIds) ? input.contactIds : [];
    const recipient =
      input.audience === "event_registrants"
        ? "Inscritas del evento gratuito"
        : input.audience === "workshop_enrollees"
          ? `Inscritas del taller${str(input.workshopSlug) ? ` ${nameFor(ctx, input.workshopSlug, str(input.workshopSlug)!)}` : ""}`
          : `${ids.length === 1 ? "1 contacto" : `${ids.length} contactos`}`;
    const lines: ApprovalLine[] = [];
    const kind = str(input.message);
    push(lines, "Mensaje", kind === "libre" ? str(input.text) && truncate(str(input.text)!) : kind && BULK_MESSAGES[kind]);
    if (kind !== "libre") push(lines, "Texto", str(input.text) && truncate(str(input.text)!));
    return {
      recipient,
      lines,
      note: input.dryRun === true ? "Solo simulación: no se envía nada." : "Le llega a cada persona por WhatsApp.",
    };
  },

  send_contact_email: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Asunto", str(input.subject));
    push(lines, "Mensaje", str(input.body) && truncate(str(input.body)!));
    if (str(input.ctaLabel)) push(lines, "Botón", `${str(input.ctaLabel)} → ${str(input.ctaUrl) ?? ""}`.trim());
    return { recipient: nameFor(ctx, input.contactId, CONTACT), lines, note: "Le llega por correo." };
  },

  send_contact_template_email: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Plantilla", str(input.templateKey));
    lines.push(...genericLines(input.vars, 4));
    return { recipient: nameFor(ctx, input.contactId, CONTACT), lines, note: "Le llega por correo." };
  },

  send_contact_sms: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Mensaje", str(input.body) && truncate(str(input.body)!));
    return { recipient: nameFor(ctx, input.contactId, CONTACT), lines, note: "Le llega por SMS (se cobra por segmento)." };
  },

  send_bulk_email: (input) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Campaña", str(input.name));
    push(lines, "Plantilla", str(input.templateKey));
    return {
      recipient:
        input.audience === "MARKETING_CONSENT"
          ? "Contactos que aceptaron recibir novedades"
          : "Todos los contactos con correo",
      lines,
      note: "Es un envío masivo por correo.",
    };
  },

  record_manual_payment: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    const amount = num(input.amountMinor);
    const currency = str(input.currency)?.toUpperCase();
    if (amount !== undefined && currency) push(lines, "Monto", `${formatMoneyMinor(amount, currency)} ${currency}`);
    push(lines, "Referencia", str(input.reference));
    if (str(input.code)) push(lines, "Código de verificación", "Incluido");
    return {
      recipient: nameFor(ctx, input.enrollmentId, "La inscripción elegida"),
      lines,
      note: "Queda registrado como pago aprobado y le llega la confirmación.",
    };
  },

  request_payment_otp: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Para", nameFor(ctx, input.enrollmentId, "La inscripción elegida"));
    push(lines, "Detalle", str(input.context));
    return { recipient: "Tu correo", lines, note: "Te llega un código para confirmar el pago." };
  },

  update_product_price: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    const usd = num(input.amountUsd);
    const cop = num(input.amountCop);
    const listUsd = num(input.listAmountUsd);
    const listCop = num(input.listAmountCop);
    if (usd !== undefined) push(lines, "Precio USD", usdWhole(usd));
    if (listUsd !== undefined) push(lines, "Antes (tachado) USD", usdWhole(listUsd));
    if (cop !== undefined) push(lines, "Precio COP", copWhole(cop));
    if (listCop !== undefined) push(lines, "Antes (tachado) COP", copWhole(listCop));
    return {
      recipient: `Todas las personas que vean ${nameFor(ctx, input.productId, "el producto")}`,
      lines,
      note: "Cambia el precio público en la web.",
    };
  },

  update_usd_to_cop_rate: (input) => {
    const rate = num(input.rate);
    return {
      recipient: "Todos los precios en pesos de la web",
      lines: rate !== undefined ? [{ label: "Nueva tasa", value: `1 USD = ${Math.round(rate).toLocaleString("es-CO")} COP` }] : [],
      note: "Recalcula los precios en pesos que salen de dólares.",
    };
  },

  create_staff_user: (input) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Nombre", str(input.displayName));
    push(lines, "Correo", str(input.email));
    push(lines, "Rol", str(input.role) && (STAFF_ROLES[str(input.role)!] ?? str(input.role)));
    return { recipient: str(input.email) ?? "La persona nueva", lines, note: "Recibe acceso al CRM." };
  },

  upload_drive_file: (input) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Archivo", str(input.name));
    if (typeof input.content === "string") push(lines, "Tamaño", `${input.content.length.toLocaleString("es-CO")} caracteres`);
    return {
      recipient: input.shareWithLink === true ? "Cualquiera con el enlace" : "Tu Google Drive",
      lines,
      note: input.shareWithLink === true ? "Queda abierto para quien tenga el enlace." : undefined,
    };
  },

  create_contact: (input) => {
    const lines: ApprovalLine[] = [];
    const name = [str(input.firstName), str(input.lastName)].filter(Boolean).join(" ");
    push(lines, "Nombre", name || undefined);
    push(lines, "Teléfono", str(input.phone));
    push(lines, "Correo", str(input.email));
    push(lines, "Notas", str(input.notes) && truncate(str(input.notes)!));
    return { lines };
  },

  create_promo_code: promoSummary,
  update_promo_code: promoSummary,
  create_workshop: workshopSummary,
  update_workshop: workshopSummary,

  create_workshop_product: (input) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Título", str(input.title));
    const usd = num(input.amountUsd);
    const cop = num(input.amountCop);
    if (usd !== undefined) push(lines, "Precio USD", usdWhole(usd));
    if (cop !== undefined) push(lines, "Precio COP", copWhole(cop));
    push(lines, "Sesiones", str(input.sessionsLabel));
    return { lines };
  },

  create_calendar_event: calendarSummary,
  update_calendar_event: calendarSummary,

  update_free_webinar: (input) => {
    const lines: ApprovalLine[] = [];
    if (typeof input.isActive === "boolean") {
      push(lines, "Página pública", input.isActive ? "Publicar" : "Cerrar inscripciones");
    }
    push(lines, "Título", str(input.headline));
    const date = str(input.startsAtDate);
    if (date) push(lines, "Fecha", `${formatDateTime(date)}${str(input.startsAtTime) ? `, ${str(input.startsAtTime)}` : ""}`);
    push(lines, "Enlace de Meet", str(input.meetUrl));
    if (lines.length === 0) lines.push(...genericLines(input, 4));
    return {
      lines,
      note: str(input.meetUrl) ? "Un enlace nuevo se manda por correo a las inscritas." : undefined,
    };
  },

  deactivate_free_webinar: (input) => ({
    lines: [
      {
        label: "Acción",
        value:
          input.mode === "reset"
            ? "Volver al borrador por defecto"
            : input.mode === "clear_schedule"
              ? "Cerrar y quitar la fecha"
              : "Cerrar inscripciones",
      },
    ],
  }),

  memory: (input) => {
    const scope = str(input.scope);
    const scopeLabel = !scope || scope === "all" ? "Todos los agentes" : isAgentId(scope) ? AGENT_PROFILES[scope].label : scope;
    const lines: ApprovalLine[] = [];
    if (input.action === "add") push(lines, "Recordar", str(input.content));
    if (input.action === "replace") {
      push(lines, "Antes", str(input.match));
      push(lines, "Ahora", str(input.content));
    }
    if (input.action === "remove") push(lines, "Olvidar", str(input.match));
    lines.push({ label: "Para", value: scopeLabel });
    return { lines };
  },

  whatsapp_update_config: (input) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Cambio", str(input.summary));
    if (typeof input.enabled === "boolean") push(lines, "IA de WhatsApp", input.enabled ? "Encendida" : "Apagada");
    return { lines, note: "Cambia cómo responde la IA de WhatsApp a todas las personas." };
  },

  whatsapp_save_playbook: (input) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Guion", str(input.name));
    if (input.delete === true) return { lines: [...lines, { label: "Acción", value: "Eliminar el guion" }] };
    push(lines, "Cuándo aplica", str(input.trigger) && truncate(str(input.trigger)!));
    push(lines, "Qué hace", str(input.steps) && truncate(str(input.steps)!));
    if (typeof input.isEnabled === "boolean") push(lines, "Activo", yesNo(input.isEnabled));
    return { lines };
  },

  whatsapp_set_chat: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Chat", nameFor(ctx, input.conversationId, "El chat elegido"));
    push(lines, "Quién responde", str(input.mode) && (CHAT_MODES[str(input.mode)!] ?? str(input.mode)));
    if (typeof input.priority === "boolean") push(lines, "Favorito", yesNo(input.priority));
    push(lines, "Ficha", str(input.memory) && truncate(str(input.memory)!));
    return { lines };
  },

  draft_conversation_reply: (input, ctx) => {
    const lines: ApprovalLine[] = [];
    push(lines, "Chat", nameFor(ctx, input.conversationId, "El chat elegido"));
    push(lines, "Borrador", str(input.body) && truncate(str(input.body)!));
    return { lines, note: "Queda como borrador: no se envía hasta que lo mandes." };
  },

  link_conversation_to_contact: (input, ctx) => ({
    lines: [
      { label: "Chat", value: nameFor(ctx, input.conversationId, "El chat elegido") },
      { label: "Contacto", value: nameFor(ctx, input.contactId, "El contacto elegido") },
    ],
  }),

  prepare_customer_whatsapp_message: (input, ctx) => {
    const lines: ApprovalLine[] = [{ label: "Para", value: nameFor(ctx, input.contactId, "El contacto elegido") }];
    push(lines, "Plantilla", str(input.templateKey));
    return { lines, note: "Prepara el enlace; el mensaje lo mandas tú." };
  },

  create_therapy_enrollment: (input, ctx) => ({
    lines: [
      { label: "Contacto", value: nameFor(ctx, input.contactId, "El contacto elegido") },
      ...(str(input.productId) ? [{ label: "Paquete", value: nameFor(ctx, input.productId, str(input.productId)!) }] : []),
    ],
  }),
};

const humanToolName = (toolName: string): string => {
  const words = toolName.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const summarizeApproval = (toolName: string, input: unknown, ctx: SummaryContext = {}): ApprovalSummary => {
  const title = toolLabel(toolName) ?? humanToolName(toolName);
  const access = accessOf(toolName);
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Input) : {};
  const specific = SUMMARIZERS[toolName]?.(record, ctx);
  const summary: ApprovalSummary = specific
    ? { title, access, ...specific }
    : { title, access, lines: genericLines(record) };

  // Execute-level tools always say who receives it, even when the tool has no
  // specific summary yet (a new tool added to the catalog).
  if (access === "execute" && !summary.recipient) {
    const who = str(record.contactId) ? nameFor(ctx, record.contactId, CONTACT) : undefined;
    summary.recipient = who ?? "Personas fuera del CRM";
  }
  return summary;
};
