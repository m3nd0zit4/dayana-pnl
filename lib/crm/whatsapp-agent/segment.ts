/**
 * En qué segmento está cada persona, para decidir quién la atiende:
 *
 * - `ignored`: personal de Dayana (familia, amigos), del equipo, o una
 *   empresa/app. Nadie le contesta solo.
 * - `client`: ya le pagó a Dayana (en el CRM o por fuera). La atiende ella.
 * - `free_call_booked`: tiene agendada la llamada gratis.
 * - `after_call`: ya tuvo la llamada gratis y no consta que haya comprado.
 *   Dayana cierra la venta en la llamada: lo que sigue es de ella, la IA no le
 *   vuelve a ofrecer la llamada.
 * - `returning_lead`: ya habló antes con Dayana o la asistente, no es clienta
 *   (también quien no contestó la llamada gratis: se le ofrece otra hora).
 * - `new_lead`: primera vez (aunque haya recibido invitaciones masivas).
 *
 * Clienta es solo quien PAGÓ y Dayana lo confirmó (pedido de la dueña,
 * 2026-10-14): un pago aprobado en el CRM, una sesión de paquete en el
 * calendario, la marca de Dayana, o Dayana confirmando el pago en el chat
 * («recibí tu pago», «bienvenida a tu proceso»). Recibir el enlace o los datos
 * de pago, decir «ya te transferí» o que la clasificación crea que es clienta
 * NO la vuelve clienta: la IA la sigue atendiendo y queda «por revisar» para
 * que Dayana lo confirme. (Antes, ante la duda, se callaba la IA, y quien solo
 * había pedido los datos de pago se quedaba sin respuesta.)
 *
 * Puro: lo usan `segment-store.ts` y las pruebas.
 */

export const SEGMENTS = ["new_lead", "returning_lead", "free_call_booked", "after_call", "client", "ignored"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABEL: Record<Segment, string> = {
  new_lead: "Nueva",
  returning_lead: "Ya conversó",
  free_call_booked: "Llamada gratis agendada",
  after_call: "Tuvo la llamada gratis",
  client: "Clienta",
  ignored: "Personal / no atender",
};

export type SegmentInput = {
  /** Número del equipo (Ajustes). */
  isTeam?: boolean;
  /** Dayana lo marcó como número personal (`whatsapp_ignored_numbers`). */
  ignoredNumber?: boolean;
  /** Categoría del chat y de dónde salió (`manual` = la puso Dayana). */
  category?: string | null;
  categorySource?: string | null;
  categoryConfidence?: number | null;
  categoryReview?: boolean;
  /** La clasificación está encendida (si no, la IA no silencia por categoría). */
  classifyEnabled?: boolean;
  crm?: {
    hasApprovedPayment?: boolean;
    hasPaidEnrollment?: boolean;
    hasTherapySession?: boolean;
    /** Inscripción activa o terminada SIN pago registrado (regalo, a mano, gratis). */
    hasUnpaidActiveEnrollment?: boolean;
  };
  history?: {
    /** Dayana confirmó el pago o habla de su proceso en el chat (`client-evidence.ts`). */
    dayanaConfirmed?: number;
    /** La persona dice que pagó o manda el comprobante: falta que Dayana lo confirme. */
    personClaims?: number;
    /** Lo mismo, según la ficha (lo leyó el modelo en todo el chat): solo para revisar. */
    dossierPaidSignals?: number;
    /** La ficha dice que ya tuvo llamada o sesiones con Dayana. */
    dossierHadSession?: boolean;
    /** Cuándo Dayana le escribió ella misma cómo pagar (enlace, cuenta, Nequi, valor): `isPaymentInfo`. */
    dayanaPaymentInfoAt?: Date | null;
  };
  freeCallUpcoming?: boolean;
  /** Cuándo se agendó su última llamada gratis (la próxima o una que ya pasó), si la hay. */
  freeCallBookedAt?: Date | null;
  /**
   * La última llamada gratis que ya pasó: `done` = se hizo (contestó, o no se
   * sabe y ya pasó: Dayana sabe), `missed` = no contestó (se le reagenda).
   */
  pastFreeCall?: "done" | "missed" | null;
  /** Ya hubo conversación de verdad antes de lo último que escribió. */
  hadConversation?: boolean;
};

export type SegmentVerdict = {
  segment: Segment;
  confidence: number;
  reason: string;
  /** Dudoso: se trata como dice `segment` y Dayana lo revisa. */
  review: boolean;
  source: "rules" | "manual" | "ai";
};

const SILENCING = new Set(["personal", "negocio", "equipo"]);

export const resolveSegment = (input: SegmentInput): SegmentVerdict => {
  const manual = input.categorySource === "manual" ? input.category : null;

  if (input.isTeam) return { segment: "ignored", confidence: 1, reason: "Número del equipo.", review: false, source: "rules" };
  if (input.ignoredNumber) {
    return { segment: "ignored", confidence: 1, reason: "Dayana lo marcó como número personal.", review: false, source: "manual" };
  }
  if (manual && SILENCING.has(manual)) {
    return { segment: "ignored", confidence: 1, reason: `Marcado a mano como ${manual}.`, review: false, source: "manual" };
  }
  if (manual === "cliente") return { segment: "client", confidence: 1, reason: "Dayana la marcó como clienta.", review: false, source: "manual" };

  const crm = input.crm ?? {};
  if (crm.hasApprovedPayment || crm.hasPaidEnrollment) {
    return { segment: "client", confidence: 0.97, reason: "Pagó en el CRM.", review: false, source: "rules" };
  }
  if (crm.hasTherapySession) {
    return { segment: "client", confidence: 0.9, reason: "Tiene sesiones en el calendario.", review: false, source: "rules" };
  }
  // Inscrita sin pago registrado (a mano, regalo, pagó por fuera): ante la
  // duda, clienta (la IA no le ofrece la llamada gratis) y Dayana lo revisa.
  if (crm.hasUnpaidActiveEnrollment && input.categorySource !== "manual") {
    return { segment: "client", confidence: 0.75, reason: "Tiene una inscripción activa sin pago registrado.", review: true, source: "rules" };
  }

  // «No es clienta» puesto a mano: lo que diga el chat no la vuelve clienta.
  const notClientByHand = Boolean(manual);
  const h = input.history ?? {};
  // Dudas que Dayana revisa sin que la IA deje de contestar.
  let doubt: string | null = null;
  if (!notClientByHand) {
    // Dayana misma confirmó el pago en el chat: eso es «pagó y lo aprobó».
    if ((h.dayanaConfirmed ?? 0) > 0) {
      return { segment: "client", confidence: 0.85, reason: "Dayana confirmó su pago en el chat.", review: false, source: "rules" };
    }
    if ((h.personClaims ?? 0) > 0) doubt = "dice que pagó o mandó un comprobante, falta que Dayana lo confirme";
    else if ((h.dossierPaidSignals ?? 0) > 0) doubt = "la ficha cree que ya pagó, falta que Dayana lo confirme";
    else if (input.category === "cliente" && (input.categoryConfidence ?? 0) >= 0.7) doubt = "la clasificación del chat cree que es clienta";
  }
  const verdict = leadSegment(input, h);
  if (!doubt || verdict.segment === "ignored") return verdict;
  return { ...verdict, review: true, reason: `${verdict.reason} Por revisar: ${doubt}.` };
};

/** Quien no es clienta: personal, llamada agendada, tuvo la llamada, ya conversó o nueva. */
const leadSegment = (input: SegmentInput, h: NonNullable<SegmentInput["history"]>): SegmentVerdict => {
  // La clasificación (si está encendida) puede silenciar lo claramente personal o de empresa.
  if (
    input.classifyEnabled &&
    input.category &&
    SILENCING.has(input.category) &&
    !input.categoryReview &&
    (input.categoryConfidence ?? 0) >= 0.9
  ) {
    return { segment: "ignored", confidence: input.categoryConfidence ?? 0.9, reason: `Clasificado como ${input.category}.`, review: false, source: "ai" };
  }

  // Dayana ya le dijo cómo pagar (después de agendar la llamada, si tiene una):
  // ya hablaron de la sesión y los valores (dueña, 21-oct). No se le ofrece ni
  // se le reagenda la llamada gratis.
  // Solo si fue después de agendar su última llamada: un valor de antes y una
  // llamada que no contestó sigue siendo «no contestó» (se le reagenda).
  const payInfo = h.dayanaPaymentInfoAt?.getTime();
  const bookedAt = input.freeCallBookedAt?.getTime();
  if (payInfo && (!bookedAt || payInfo > bookedAt)) {
    return {
      segment: "after_call",
      confidence: 0.85,
      reason: "Dayana ya le mandó cómo pagar: ya hablaron de la sesión y los valores; no consta que haya pagado.",
      review: false,
      source: "rules",
    };
  }
  if (input.freeCallUpcoming) {
    return { segment: "free_call_booked", confidence: 0.95, reason: "Tiene agendada la llamada gratis.", review: false, source: "rules" };
  }
  if (input.pastFreeCall === "done") {
    return { segment: "after_call", confidence: 0.85, reason: "Ya tuvo la llamada gratis; no consta que haya comprado.", review: false, source: "rules" };
  }
  if (input.pastFreeCall === "missed") {
    return { segment: "returning_lead", confidence: 0.9, reason: "No contestó la llamada gratis: se le ofrece otra hora.", review: false, source: "rules" };
  }
  // La ficha (que leyó todo el chat, también lo importado) dice que ya habló
  // con Dayana: si no es clienta, es alguien que ya tuvo la llamada.
  if (h.dossierHadSession) {
    return { segment: "after_call", confidence: 0.7, reason: "Según el chat, ya habló con Dayana (llamada o sesión); no consta que haya comprado.", review: false, source: "ai" };
  }
  if (input.hadConversation) {
    return { segment: "returning_lead", confidence: 0.9, reason: "Ya conversó antes, no consta que haya pagado.", review: false, source: "rules" };
  }
  return { segment: "new_lead", confidence: 0.9, reason: "Primera vez que conversa.", review: false, source: "rules" };
};
