import type { AgentId } from "@/agent/lib/catalog";
import type { TurnExpect } from "./graders";

/**
 * The panel agents' eval set: real questions the team asks (statistics,
 * lookups, actions that need approval, teaching the agent), run against
 * neondb_dev with the fixtures from `scripts/agent/eval-fixtures.ts`
 * («Valentina Prueba Eval»: therapy 570.000 COP paid 5 days ago, workshop
 * 49 USD paid 3 days ago, a declined PayPal attempt yesterday, a pending
 * 6-session package of 980.000 COP).
 *
 * `respond` says what the eval does with an approval card. Sends, payments
 * and prices are always denied: the dev database holds a real WhatsApp key,
 * and the payment code goes to the owner's real inbox.
 */

export type EvalTurn = {
  say: string;
  respond?: "approve" | "deny";
  /** When the agent asks a question, answer with this text. */
  answer?: string;
  expect: TurnExpect;
};

export type EvalCase = {
  id: string;
  agent: AgentId;
  turns: EvalTurn[];
  /** What a good final answer does, for the judge. */
  goal: string;
};

const NO_RAW_SUM = /(570[.,]?000\s*COP\s*[+y]\s*49|619[.,]?000|575[.,]?\d{3}\s*(COP|USD))/i;

export const EVAL_CASES: EvalCase[] = [
  // ── statistics ─────────────────────────────────────────────────────────
  {
    id: "stats-ventas-30d",
    agent: "auto",
    turns: [
      {
        say: "¿Cuánto vendimos en los últimos 30 días?",
        expect: { anyTool: ["crm_stats", "ventas"], replyMatches: [/570[.,]000/, /49([.,]00)?\s*USD|USD\s*49|US\$\s*49/i], replyAvoids: [NO_RAW_SUM] },
      },
    ],
    goal: "Da los ingresos por moneda (570.000 COP y 49 USD) sin sumarlos entre sí, y una línea de lectura frente al periodo anterior.",
  },
  {
    id: "stats-este-mes-vs-anterior",
    agent: "ventas",
    turns: [{ say: "Compara las ventas de este mes con las del mes pasado", expect: { anyTool: ["crm_stats"] } }],
    goal: "Usa estadísticas del mes en curso (del 1 a hoy) frente al mes anterior y dice si subió o bajó, por moneda.",
  },
  {
    id: "stats-contactos-semana",
    agent: "auto",
    turns: [{ say: "¿Cuántos contactos nuevos llegaron esta semana y de dónde vienen?", expect: { anyTool: ["crm_stats"] } }],
    goal: "Da el número de contactos nuevos de los últimos 7 días y las fuentes principales.",
  },
  {
    id: "stats-embudo",
    agent: "auto",
    turns: [{ say: "¿Cómo va el embudo del diagnóstico en los últimos 90 días?", expect: { anyTool: ["crm_stats", "ventas"] } }],
    goal: "Describe los pasos del embudo del diagnóstico con su conversión, o dice con claridad que no hubo diagnósticos si los números están en cero.",
  },
  {
    id: "stats-producto-top",
    agent: "ventas",
    turns: [{ say: "¿Qué producto nos dejó más plata este mes?", expect: { anyTool: ["crm_stats"] } }],
    goal: "Nombra el producto con más ingresos del periodo según el desglose por producto, cuidando de no comparar COP con USD como si fueran la misma moneda.",
  },
  {
    id: "stats-pagos-fallidos",
    agent: "auto",
    turns: [{ say: "¿Qué pagos fallaron esta semana y por qué?", expect: { anyTool: ["list_payments", "crm_stats", "ventas"], replyMatches: [/rechaz|declin|INSTRUMENT/i] } }],
    goal: "Encuentra el pago de PayPal rechazado de Valentina Prueba Eval y explica el motivo (el banco rechazó la tarjeta).",
  },
  {
    id: "stats-whatsapp",
    agent: "auto",
    turns: [{ say: "¿Cómo le fue a la IA de WhatsApp esta semana? ¿Cuántas llamadas gratis agendó?", expect: { anyTool: ["crm_stats", "whatsapp_ai_status", "whatsapp"] } }],
    goal: "Da cifras de la última semana de WhatsApp (personas nuevas, llamadas gratis agendadas) a partir de la herramienta.",
  },

  // ── lookups ────────────────────────────────────────────────────────────
  {
    id: "lookup-cliente",
    agent: "auto",
    turns: [
      {
        say: "Busca a Valentina Prueba Eval y dime qué ha comprado y qué tiene pendiente",
        expect: { allTools: ["search_contacts"], anyTool: ["get_contact"], replyMatches: [/primer paso|terapia/i, /pendiente|transformaci/i] },
      },
    ],
    goal: "Dice que compró Primer Paso (terapia) y el taller, y que tiene pendiente de pago el paquete Transformación.",
  },
  {
    id: "lookup-pendientes",
    agent: "auto",
    turns: [{ say: "¿Qué tengo pendiente hoy?", expect: { anyTool: ["pending_tasks"] } }],
    goal: "Resume los pendientes del panel con sus cantidades, empezando por lo urgente; si no hay nada, lo dice.",
  },
  {
    id: "lookup-whatsapp-te-toca",
    agent: "whatsapp",
    turns: [{ say: "¿Qué chats me tocan ahora?", expect: { anyTool: ["whatsapp_find_chat"] } }],
    goal: "Lista los chats que esperan a Dayana (cola «Te toca») con nombre y por qué, o dice que no hay ninguno.",
  },
  {
    id: "lookup-talleres",
    agent: "talleres",
    turns: [{ say: "¿Qué talleres tenemos y cuál está abierto?", expect: { anyTool: ["list_workshop_editions"] } }],
    goal: "Lista los talleres por nombre con su estado y dice cuál está abierto, sin pegar slugs ni ids.",
  },
  {
    id: "lookup-agenda",
    agent: "agenda",
    turns: [{ say: "¿Qué tengo en el calendario esta semana?", expect: { anyTool: ["list_calendar_events", "list_google_accounts"] } }],
    goal: "Describe los eventos de la semana por título y hora, o explica en una o dos líneas que Google Calendar no está conectado y dónde se conecta, sin reintentar en bucle.",
  },

  // ── actions with exactly one approval ──────────────────────────────────
  {
    id: "accion-crear-contacto",
    agent: "contactos",
    turns: [
      {
        say: "Crea el contacto Prueba Eval Agente con el teléfono +57 300 555 0101",
        respond: "approve",
        expect: { allTools: ["create_contact"], approvals: 1 },
      },
    ],
    goal: "Crea el contacto tras una sola aprobación (sin preguntar «¿confirmas?» antes) y confirma en una línea que quedó creado.",
  },
  {
    id: "accion-promo-rechazada",
    agent: "ventas",
    turns: [
      {
        say: "Crea un código promocional EVALTEST10 con 10% de descuento",
        respond: "deny",
        expect: { allTools: ["create_promo_code"], approvals: 1 },
      },
    ],
    goal: "Pide la aprobación una sola vez; al ser cancelada, dice que no se creó y pregunta qué cambiar, sin volver a intentarlo.",
  },
  {
    id: "accion-whatsapp-rechazado",
    agent: "whatsapp",
    turns: [
      {
        say: "Mándale un WhatsApp a Valentina Prueba Eval diciéndole que su próxima sesión es el lunes a las 3 pm",
        respond: "deny",
        expect: { anyTool: ["send_whatsapp_to_contact"], approvals: 1 },
      },
    ],
    goal: "Busca a la persona y prepara el envío con una sola tarjeta de aprobación; al cancelarse dice que no se envió nada.",
  },
  {
    id: "accion-pago-manual-otp",
    agent: "ventas",
    turns: [
      {
        say: "Registra un pago en efectivo de 980.000 COP del paquete Transformación de Valentina Prueba Eval",
        respond: "deny",
        expect: { anyTool: ["request_payment_otp"], noTools: ["record_manual_payment", "update_product_price"], approvals: 1 },
      },
    ],
    goal: "Encuentra la inscripción pendiente y empieza por pedir el código de verificación (una sola aprobación); no registra el pago sin código ni toca precios.",
  },

  // ── teaching and delegation ────────────────────────────────────────────
  {
    id: "memoria-aprende",
    agent: "auto",
    turns: [
      {
        say: "De ahora en adelante, cuando te pida ventas dame primero el total en COP y después en USD, y no me pongas más de tres líneas.",
        expect: { allTools: ["memory"], approvals: 0 },
      },
    ],
    goal: "Guarda la preferencia como regla en memoria y confirma en una línea qué recordará.",
  },
  {
    id: "delegar-bloquear-dia",
    agent: "auto",
    turns: [
      {
        say: "Bloquéame el próximo viernes completo, no quiero que me agenden citas ese día",
        respond: "deny",
        expect: { anyTool: ["agenda"] },
      },
    ],
    goal: "Delega en el especialista de Agenda con la fecha ya resuelta; el resultado es un evento ocupado de todo el día en el calendario de citas (que llega como una sola aprobación) o una explicación clara de qué falta (p. ej. Google no conectado).",
  },
  {
    id: "delegar-corregir-ia-whatsapp",
    agent: "auto",
    turns: [
      {
        say: "Cuando alguien pregunte por el precio de la terapia, la IA de WhatsApp tiene que preguntar primero qué está viviendo la persona antes de dar opciones. Arréglalo.",
        respond: "deny",
        expect: { anyTool: ["whatsapp"] },
      },
    ],
    goal: "Delega en el especialista de WhatsApp, que propone un guion (playbook) o cambio de configuración de la IA de WhatsApp con esa regla, pidiendo una sola aprobación; no lo guarda como memoria del asistente del panel.",
  },
];
