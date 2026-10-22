import type { Segment, SegmentVerdict } from "./segment";

/**
 * En qué punto está cada persona con Dayana, según su chat y el CRM: el
 * «estado» que ve Dayana en el chat y en la lista, y que la IA lee antes de
 * contestar.
 *
 * Es más fino que el segmento (que solo decide quién atiende): dentro de
 * «clienta» distingue a quien está en proceso de quien ya terminó, y dentro de
 * «ya conversó» a quien no contestó la llamada gratis. Cada estado cae en un
 * solo segmento, así que el enrutador no cambia.
 *
 * Puro: lo usan `segment-store.ts` y las pruebas.
 */

export const STAGES = [
  "nueva",
  "conversando",
  "llamada_agendada",
  "no_contesto",
  "tuvo_llamada",
  "clienta_activa",
  "clienta_pasada",
  "por_revisar",
  "personal",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  nueva: "Nueva",
  conversando: "Conversando",
  llamada_agendada: "Llamada gratis agendada",
  no_contesto: "No contestó la llamada",
  tuvo_llamada: "Tuvo la llamada, sin compra registrada",
  clienta_activa: "Clienta en proceso",
  clienta_pasada: "Ya fue clienta",
  por_revisar: "¿Clienta? Por revisar",
  personal: "Personal / no atender",
};

/** Qué hace la IA en cada estado (la ayuda de la lista y lo que lee la IA). */
export const STAGE_HELP: Record<Stage, string> = {
  nueva: "Primera vez que conversa. La asistente la saluda y la lleva a la llamada gratis.",
  conversando: "Ya habló antes y no ha agendado. La asistente sigue donde quedó, sin saludarla como nueva.",
  llamada_agendada: "Tiene la llamada gratis agendada. La asistente le confirma y la acompaña hasta la hora.",
  no_contesto: "No contestó la llamada gratis. La asistente le ofrece otra hora.",
  tuvo_llamada: "Ya tuvo la llamada con Dayana (o Dayana ya le mandó cómo pagar) y no consta que haya pagado. La asistente la acompaña: le ayuda a pagar con lo que le mandó Dayana y recibe su comprobante. No hay otra llamada gratis.",
  clienta_activa: "Pagó y tiene un proceso o una sesión en curso. La atiende Dayana.",
  clienta_pasada: "Pagó antes (un proceso, una sesión o un taller) y no tiene nada en curso. La atiende Dayana.",
  por_revisar: "Puede que ya haya pagado (lo dice el chat o tiene una inscripción sin pago registrado), pero Dayana no lo ha confirmado. No se le ofrece la llamada gratis.",
  personal: "Familia, amigos, equipo o una empresa. Nadie le contesta solo.",
};

/**
 * Lo que la IA tiene que hacer distinto en algunos estados (si Dayana deja
 * que la IA los atienda: por defecto, «tuvo la llamada» y clientas son suyos).
 */
export const STAGE_AI_RULE: Partial<Record<Stage, string>> = {
  no_contesto:
    "No alcanzó a hablar con Dayana en su llamada gratis: sin reproches, ofrécele otra hora para la llamada.",
  tuvo_llamada:
    "Ya habló con Dayana (tuvo su llamada gratis o Dayana ya le dijo cómo pagar): no le ofrezcas otra llamada gratis ni la saludes como nueva. Si quiere pagar o pregunta a qué cuenta: si Dayana ya le mandó cómo pagar, que pague con eso (send_payment_link si fue un enlace); si no, dale los datos de pago con send_payment_info. Si pide reagendar, otra llamada, una consulta o una sesión gratis, o que la ayudes con lo que siente: no se la das; dile directo que ya tuvo su llamada gratis con Dayana y que la siguiente llamada o sesión es después del pago: que pague (send_payment_link si Dayana le mandó enlace; si no, pregúntale si prefiere el enlace o los datos para transferencia) y te mande el comprobante por aquí para que Dayana lo verifique y le agende. Si insiste, sé más directa: el paso es el pago. Si pregunta cuánto cuesta o qué proceso le conviene (no si solo repite el valor que le dio Dayana), eso lo confirma Dayana: escala con category=payment.",
  clienta_activa: "Es clienta: nunca le ofrezcas la llamada gratis. Da continuidad a su proceso.",
  clienta_pasada: "Ya fue clienta: nunca le ofrezcas la llamada gratis. Si quiere retomar, escala para que Dayana la atienda.",
  por_revisar: "Puede que ya sea clienta: no le ofrezcas la llamada gratis.",
};

/**
 * Estados en los que nunca se le ofrece la llamada gratis: ya la tuvo, ya es
 * (o puede ser) clienta, o no es de trabajo. Se aplica en el código (sin las
 * herramientas de la llamada gratis), no solo en el prompt.
 */
export const NO_FREE_CALL_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  "tuvo_llamada",
  "clienta_activa",
  "clienta_pasada",
  "por_revisar",
  "personal",
]);

export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);

export type StageInput = {
  verdict: Pick<SegmentVerdict, "segment" | "review">;
  /** Matrícula activa, o una sesión pagada próxima en el calendario. */
  activeProcess?: boolean;
  /** La última llamada gratis que ya pasó, si no contestó. */
  missedFreeCall?: boolean;
};

export const resolveStage = (input: StageInput): Stage => {
  const segment: Segment = input.verdict.segment;
  switch (segment) {
    case "ignored":
      return "personal";
    case "client":
      if (input.verdict.review) return "por_revisar";
      return input.activeProcess ? "clienta_activa" : "clienta_pasada";
    case "free_call_booked":
      return "llamada_agendada";
    case "after_call":
      return "tuvo_llamada";
    case "returning_lead":
      return input.missedFreeCall ? "no_contesto" : "conversando";
    case "new_lead":
      return "nueva";
  }
};
