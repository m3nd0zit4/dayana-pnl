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
 * La regla de oro (pedido de la dueña): tratar a una clienta como si fuera
 * nueva y ofrecerle la llamada gratis es mucho peor que pasarle a Dayana a
 * alguien que no era clienta. Ante la duda sobre si pagó, se trata como
 * clienta (la IA calla) y queda «por revisar» para que Dayana lo confirme.
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
    /** Frases que dicen que pagó o que tiene sesiones (`client-evidence.ts`). */
    strongEvidence?: number;
    /** Lo mismo, según la ficha (lo leyó el modelo en todo el chat). */
    dossierPaidSignals?: number;
    /** La ficha dice que ya tuvo llamada o sesiones con Dayana. */
    dossierHadSession?: boolean;
  };
  freeCallUpcoming?: boolean;
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
  if (!notClientByHand) {
    const strong = h.strongEvidence ?? 0;
    const signals = h.dossierPaidSignals ?? 0;
    if (strong > 0 && signals > 0) {
      return { segment: "client", confidence: 0.9, reason: "En el chat consta que pagó (frases y ficha coinciden).", review: false, source: "ai" };
    }
    // «Ya tuvo llamada» sola no la hace clienta: la llamada gratis también cuenta ahí.
    if (strong > 0 || signals > 0) {
      return {
        segment: "client",
        confidence: 0.6,
        reason: strong > 0 ? "El chat dice que pagó o tiene sesiones." : "La ficha cree que ya pagó.",
        review: true,
        source: strong > 0 ? "rules" : "ai",
      };
    }
  }

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
