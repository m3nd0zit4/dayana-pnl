import type { WhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";

import { AGREED_MAX_AGE_MS, agreedProposal, type AgreedLine } from "./agreed-time";
import type { BrainResult } from "./brain";
import {
  afterFreeCallBooked,
  afterFreeCallMoved,
  bookFreeCall,
  dualZoneLabel,
  FreeCallError,
  freeCallService,
  freeCallSlotsAround,
  latestFreeCallOffer,
  moveFreeCall,
  offerFreeCallSlotsFor,
  upcomingFreeCall,
} from "./free-call";
import {
  agreedTakenMessage,
  alreadyMessage,
  bookedMessage,
  claimMatches,
  narrowMessage,
  replyToOffer,
  resolveChoice,
  takenMessage,
  type OfferedSlot,
} from "./slot-choice";

/**
 * El turno de agenda sin el modelo (pedido del dueño, 21-oct: «un agente de
 * agendamiento sin errores»). Si la persona le contesta a la última lista de
 * horas y lo que escribió señala UNA opción, el código la agenda (o mueve la
 * que tiene) y la confirmación sale con la hora de la reserva de verdad. Si
 * señala varias, pregunta entre esas; si la hora ya no está, ofrece otras.
 * Si acepta la hora que la asistente le propuso sola (sin lista), el código la
 * agenda si está libre o le ofrece las más cercanas (`agreedTimeTurn`).
 * Ante cualquier duda devuelve null y la vuelta sigue con el modelo, como antes.
 *
 * Devuelve lo mismo que `think()`, así `run.ts` lo envía por el mismo camino
 * (Dayana contestó mientras tanto, tomó el chat, freno de promesas).
 */
export type BookingTurnInput = {
  config: WhatsAppAiConfig;
  conversationId: string;
  contactId: string | null;
  phone: string;
  /** El nombre seguro (lo dijo, Dayana le dice así, un formulario) o null. */
  firstName: string | null;
  /** El nombre para el título del evento (como lo usa `book_free_call`). */
  name: string | null;
  personTz: string | null;
  dayanaTz: string;
  /** Mensajes del chat, del más nuevo al más viejo (`conversation.messages`). */
  messages: AgreedLine[];
  /**
   * Lo que el modelo le confirmó sin agendar («tu llamada queda para el viernes…»):
   * con él, lo que escribió la persona se lee sin la lista corta de palabras, y la
   * opción tiene que ser la misma que confirmó el modelo. Si no, nada.
   */
  claim?: string;
  now?: Date;
};

const result = (message: string, toolCalls: BrainResult["toolCalls"], extra: Partial<BrainResult> = {}): BrainResult => ({
  outcome: { kind: "reply", message },
  stickerUrl: null,
  examples: [],
  toolCalls,
  booking: null,
  pendingBooking: null,
  pendingPayment: null,
  pendingSlots: null,
  slotOffer: null,
  bookingNotice: null,
  silentEscalation: null,
  serious: false,
  bookingRequest: null,
  suggestedReply: null,
  holdingReply: null,
  paymentBlocks: { details: [], link: null },
  linkBlocks: [],
  urgentSession: null,
  receipt: null,
  noReply: null,
  model: "agenda",
  usage: {},
  ...extra,
});

/** Lo registrado como lo registraría el modelo: `offeredFreeCallSlots`, el freno y la evaluación lo leen igual. */
const offered = (options: OfferedSlot[], why: string) => ({ tool: "offer_free_call_slots", input: { via: "agenda", why }, output: { ok: true, options } });

/** Agenda (o mueve) una hora que la persona eligió o aceptó. `taken`: qué se le dice si esa hora ya no se puede. */
const bookChosen = async (
  input: BookingTurnInput,
  c: {
    start: Date;
    said: string;
    now: Date;
    personTz: string;
    /** Es la hora que ya tiene: el código se lo dice (lista) o lo deja al modelo (hora aceptada). */
    sameAsUpcoming: "tell" | "model";
    taken: (code: string) => Promise<BrainResult | null>;
  }
): Promise<BrainResult | null> => {
  const startIso = c.start.toISOString();
  const service = freeCallService(input.config);
  const upcoming = await upcomingFreeCall(input.conversationId, input.config, c.now).catch(() => null);
  const booked = (kind: "booked" | "moved", b: { bookingId: string; startsAt: Date; label: string }) =>
    result(
      bookedMessage(kind, b.label, input.firstName),
      [{ tool: "book_free_call", input: { startIso, via: "agenda", said: c.said }, output: { ok: true, booked: true, moved: kind === "moved", label: b.label } }],
      {
        booking: { id: b.bookingId, startsAt: b.startsAt, service: service.name, meetUrl: null },
        bookingNotice: { kind, label: b.label, text: bookedMessage(kind, b.label, input.firstName) },
      }
    );

  try {
    if (upcoming && upcoming.startsAt.getTime() === c.start.getTime()) {
      if (c.sameAsUpcoming === "model") return null;
      const label = dualZoneLabel(startIso, c.personTz, input.dayanaTz);
      return result(alreadyMessage(label), [
        { tool: "book_free_call", input: { startIso, via: "agenda", said: c.said }, output: { ok: true, alreadyBooked: true, label } },
      ]);
    }
    // La puso Dayana a mano: no se mueve sola (el modelo le dice que se lo pasa a Dayana).
    if (upcoming?.source === "calendar") return null;
    if (upcoming) {
      const moved = await moveFreeCall({ config: input.config, dayanaTz: input.dayanaTz, personTz: c.personTz, bookingId: upcoming.id, start: c.start });
      afterFreeCallMoved({ conversationId: input.conversationId, booking: moved, dayanaTz: input.dayanaTz });
      return booked("moved", moved);
    }
    const booking = await bookFreeCall({
      config: input.config,
      dayanaTz: input.dayanaTz,
      personTz: c.personTz,
      start: c.start,
      conversationId: input.conversationId,
      contactId: input.contactId,
      phone: input.phone,
      name: input.name,
    });
    await afterFreeCallBooked({ conversationId: input.conversationId, contactId: input.contactId, phone: input.phone, booking });
    return booked("booked", booking);
  } catch (e) {
    // Ya tiene otra (carrera): el modelo se lo recuerda. Un error del calendario: el modelo escala.
    if (!(e instanceof FreeCallError) || e.code === "already_booked" || e.code === "not_movable") return null;
    // Esa hora ya no está (ocupada, el día lleno, muy cerca): otras de verdad, sin la que falló.
    const r = await c.taken(e.code);
    if (r) r.toolCalls.unshift({ tool: "book_free_call", input: { startIso, via: "agenda", said: c.said }, output: { error: e.message, code: e.code } });
    return r;
  }
};

/**
 * Aceptó la hora que la asistente le propuso sola (Xime, 22-oct: «Mañana viernes
 * a las 8:00 a. m. de tu hora…, ¿te queda bien?» → «si mañana esta perfecto a
 * esa hora», y nadie la agendó). Esa hora no salió de la agenda: el código la
 * agenda solo si está entre las horas libres de Dayana. Si no, se lo dice y le
 * manda las libres más cercanas (quedan ofrecidas: «1» se agenda). La misma hora
 * que ya tiene, o cualquier duda: null (el modelo, como antes).
 */
export const agreedTimeTurn = async (input: BookingTurnInput): Promise<BrainResult | null> => {
  const now = input.now ?? new Date();
  const personTz = input.personTz ?? input.dayanaTz;
  const agreed = agreedProposal(input.messages, { personTz, dayanaTz: input.dayanaTz, now, maxAgeMs: AGREED_MAX_AGE_MS });
  if (!agreed) return null;
  const start = new Date(agreed.startIso);
  if (start.getTime() <= now.getTime()) return null;
  const label = dualZoneLabel(agreed.startIso, personTz, input.dayanaTz);
  const around = await freeCallSlotsAround({ config: input.config, personTz, dayanaTz: input.dayanaTz, around: start, now });
  const taken = async (why: string): Promise<BrainResult | null> => {
    const options = around.options.filter((o) => new Date(o.startIso).getTime() !== start.getTime());
    if (!options.length) return null;
    // La hora acordada va en el rastro con su etiqueta: el freno de promesas la ve respaldada al nombrarla.
    return result(
      agreedTakenMessage(label, options),
      [
        { tool: "agreed_time", input: { startIso: agreed.startIso, said: agreed.said }, output: { free: false, why, label } },
        offered(options, `la hora que aceptó (${label}) ya no está libre (${why})`),
      ],
      { slotOffer: { options, matchedWish: false } }
    );
  };
  if (!around.free) return taken("ocupada");
  return bookChosen(input, { start, said: agreed.said, now, personTz, sameAsUpcoming: "model", taken });
};

export const bookingTurn = async (input: BookingTurnInput): Promise<BrainResult | null> => {
  const now = input.now ?? new Date();
  const offer = await latestFreeCallOffer(input.conversationId, now);
  const said = offer ? replyToOffer(input.messages, offer) : null;
  // No le contesta a una lista: puede estar aceptando la hora que le propuso la
  // asistente sola. Con `claim` (el modelo ya confirmó algo) solo vale la lista.
  if (!offer || !said) return input.claim === undefined ? agreedTimeTurn(input) : null;
  const personTz = input.personTz ?? input.dayanaTz;
  // «hoy» y «mañana» desde cuando lo escribió, no desde cuando se procesa
  // (un «mañana» de las 11:59 p. m. visto pasada la medianoche).
  const wroteAt = input.messages.find((m) => m.direction === "INBOUND")?.sentAt ?? now;
  const ctx = { personTz, dayanaTz: input.dayanaTz, now: wroteAt };
  const choice = resolveChoice(said, offer.options, ctx, { lenient: input.claim !== undefined });
  if (choice.kind === "none") return null;
  if (input.claim !== undefined && (choice.kind !== "one" || !claimMatches(input.claim, choice.option, ctx))) return null;
  // Cuadran varias («el viernes»): se pregunta solo entre esas, numeradas otra vez.
  if (choice.kind === "many") {
    return result(narrowMessage(choice.options), [offered(choice.options, `varias opciones para «${said.slice(0, 60)}»`)], {
      slotOffer: { options: choice.options, matchedWish: true },
    });
  }

  const start = new Date(choice.option.startIso);
  if (start.getTime() <= now.getTime()) return null;
  return bookChosen(input, {
    start,
    said,
    now,
    personTz,
    sameAsUpcoming: "tell",
    taken: async (code) => {
      // Esa hora ya no está (ocupada, el día lleno, muy cerca): otras de verdad, sin la que falló.
      const fresh = await offerFreeCallSlotsFor({ config: input.config, personTz, dayanaTz: input.dayanaTz, now }).catch(() => null);
      const options = (fresh?.options ?? []).filter((o) => new Date(o.startIso).getTime() !== start.getTime());
      if (!options.length) return null;
      return result(takenMessage(options), [offered(options, `la hora elegida no se pudo agendar (${code})`)], { slotOffer: { options, matchedWish: true } });
    },
  });
};
