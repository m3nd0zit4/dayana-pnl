import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig, type WhatsAppAiConfig } from "../whatsapp-ai-config";
import { areRemindersEnabled, sendDueReminders, sendSoonReminders, syncAppointments } from "./appointments";
import { sweepCallOutcomes } from "./call-outcome";
import { answerUnansweredChats } from "./catch-up";
import { runEventsClock } from "../events-clock";
import { sweepSessionNoShows } from "./no-show";
import { sweepSessionArrivals } from "./session-arrival";
import { sweepQuoteFollowUps } from "./quote-follow-up";
import { computeSegment } from "./segment-store";

/**
 * El reloj que va pegado a los avisos de WhatsApp: los recordatorios no
 * pueden depender del cron de GitHub (sin el secreto `CRON_SECRET` no llama a
 * nada, y el cron de Vercel Hobby solo corre una vez al día).
 *
 * Cada aviso que llega por el webhook (mensajes, entregados, leídos) y el
 * stream de la sección de WhatsApp lo despiertan sin esperar; casi siempre no
 * le toca nada y sale con una sola lectura. Cada paso tiene su turno en
 * `site_settings` (un `UPDATE` condicional: aunque lleguen diez avisos a la
 * vez, solo uno gana):
 * - cada 15 min: leer el calendario (`syncAppointments`, solo lectura salvo el
 *   interruptor de completar títulos);
 * - cada 5 min: el recordatorio de 24 h y el de la llamada gratis de 1 h;
 * - cada 5 min: el seguimiento de la llamada gratis (`sweepCallOutcomes`: ¿se
 *   hizo?, «¿Pudiste hablar con Dayana?», horas para reagendar). Solo con su
 *   interruptor de Ajustes (`callFollowUp.enabled`); el general de la IA lo
 *   mira el barrido, igual que en la ruta del cron.
 * - cada 10 min: los chats sin respuesta («pendientes», `answerUnansweredChats`):
 *   la persona escribió en las últimas 23 h y nadie le contestó porque la IA
 *   falló (sin créditos de Gemini, WhatsApp rechazó el envío…). Se vuelve a
 *   intentar sola cuando todo vuelve (2026-10-16: Gemini sin créditos y
 *   360dialog con fallas dejaron chats sin respuesta). Cada chat, como mucho
 *   una vez cada 30 min; el general de la IA y las reglas de siempre los mira
 *   el ejecutor.
 * - cada 10 min: el reloj de los eventos (`runEventsClock`: correos y WhatsApp
 *   del webinar gratuito y de los talleres, cierres), que también es de la ruta
 *   `/api/cron/eventos` y nunca corrió sin `CRON_SECRET` (16-oct: los
 *   recordatorios del webinar del 25 no iban a salir). 90 s por pasada: lo que
 *   no cabe sale en la siguiente.
 * - cada 3 min: las sesiones pagadas sin asistir (`sweepSessionNoShows`: a los
 *   12 min, si en Meet solo está Dayana, el mensaje para reagendar). Corto:
 *   también en el stream.
 * - cada 15 min: el seguimiento del cierre (`sweepQuoteFollowUps`: a quien
 *   Dayana ya le mandó cómo pagar y no ha pagado, el 1º y el 2º mensaje para
 *   iniciar su proceso). Solo con `quoteFollowUp.enabled`; no en el stream.
 * - cada minuto: te esperan en la sala (`sweepSessionArrivals`: a la hora de
 *   una sesión con Meet, si la persona entró y Dayana no, un aviso a su
 *   celular). Solo consulta Meet si hay una sesión en su hora. Corto: también
 *   en el stream.
 *
 * Los envíos reclaman cada cita antes de mandar, así que este reloj y la ruta
 * del cron nunca mandan el mismo recordatorio dos veces. Nunca lanza.
 */

export const CLOCK_SYNC_KEY = "whatsapp.clock.sync_at";
export const CLOCK_REMINDERS_KEY = "whatsapp.clock.reminders_at";
export const CLOCK_FOLLOWUP_KEY = "whatsapp.clock.followup_at";
export const CLOCK_PENDING_KEY = "whatsapp.clock.pending_at";
export const CLOCK_EVENTS_KEY = "whatsapp.clock.events_at";
export const CLOCK_NOSHOW_KEY = "whatsapp.clock.noshow_at";
export const CLOCK_ARRIVAL_KEY = "whatsapp.clock.arrival_at";
export const CLOCK_QUOTE_KEY = "whatsapp.clock.quote_at";
export const CLOCK_SYNC_EVERY_MS = 15 * 60_000;
export const CLOCK_REMINDERS_EVERY_MS = 5 * 60_000;
export const CLOCK_FOLLOWUP_EVERY_MS = 5 * 60_000;
export const CLOCK_PENDING_EVERY_MS = 10 * 60_000;
export const CLOCK_EVENTS_EVERY_MS = 10 * 60_000;
export const CLOCK_NOSHOW_EVERY_MS = 3 * 60_000;
export const CLOCK_ARRIVAL_EVERY_MS = 60_000;
export const CLOCK_QUOTE_EVERY_MS = 15 * 60_000;

/** El turno guardado (milisegundos, como texto). Lo que no se entienda cuenta como «nunca». */
export const parseClockValue = (raw: string | null | undefined): number => {
  const ms = /^\d{1,15}$/.test(raw?.trim() ?? "") ? Number(raw) : 0;
  return Number.isSafeInteger(ms) ? ms : 0;
};

/** ¿Ya le toca? (La misma cuenta que hace el `UPDATE` de `claimClockSlot`.) */
export const clockSlotDue = (lastMs: number, nowMs: number, everyMs: number): boolean => nowMs - lastMs >= everyMs;

/**
 * Toma el turno de `key` si el último fue hace `everyMs` o más. Una sola
 * sentencia: crea la fila si falta y si no, la actualiza solo si el turno
 * guardado ya venció. Con invocaciones a la vez, Postgres bloquea la fila y la
 * segunda vuelve a evaluar la condición sobre el turno recién escrito: gana
 * una sola. Devuelve si este proceso ganó.
 */
export const claimClockSlot = async (key: string, everyMs: number, now: Date = new Date()): Promise<boolean> => {
  const nowMs = Math.floor(now.getTime());
  const dueBefore = String(nowMs - everyMs);
  const updated = await prisma.$executeRaw`
    INSERT INTO "site_settings" ("key", "value", "updated_at")
    VALUES (${key}, ${String(nowMs)}, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = EXCLUDED."updated_at"
    WHERE (CASE WHEN "site_settings"."value" ~ '^[0-9]{1,15}$' THEN "site_settings"."value"::bigint ELSE 0 END) <= ${dueBefore}::bigint
  `;
  return updated > 0;
};

type StepResult = { name: string; ok: boolean; result?: unknown; error?: string };

const step = async (name: string, fn: () => Promise<unknown>): Promise<StepResult> => {
  try {
    return { name, ok: true, result: await fn() };
  } catch (e) {
    console.warn(`[reloj WhatsApp · avisos] ${name}`, e instanceof Error ? e.message : e);
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export type ClockTickDeps = {
  now?: Date;
  /** Para pruebas: qué hacer en cada paso, sin calendario ni envíos de verdad. */
  sync?: () => Promise<unknown>;
  dayBefore?: () => Promise<unknown>;
  soon?: () => Promise<unknown>;
  /** El seguimiento de la llamada gratis (solo se llama con `callFollowUp.enabled`). */
  followUp?: (config: WhatsAppAiConfig) => Promise<unknown>;
  /** Los chats sin respuesta. */
  pending?: () => Promise<unknown>;
  /** El reloj de los eventos (webinar gratuito y talleres). */
  events?: () => Promise<unknown>;
  /** Las sesiones pagadas sin asistir (Meet). */
  noShow?: (config: WhatsAppAiConfig) => Promise<unknown>;
  /** Te esperan en la sala (Meet). */
  arrival?: (config: WhatsAppAiConfig) => Promise<unknown>;
  /** El seguimiento del cierre (solo con `quoteFollowUp.enabled`). */
  quote?: (config: WhatsAppAiConfig) => Promise<unknown>;
  /**
   * Solo los pasos cortos (citas, recordatorios, seguimiento): el stream del
   * CRM puede cortarse en cualquier momento, y «pendientes» y «eventos»
   * reclaman filas que, cortadas a medias, no se vuelven a intentar.
   */
  light?: boolean;
};

/**
 * Una pasada: lo que toque según los turnos. `[]` casi siempre (no le tocaba
 * nada). Nunca lanza: un fallo de un paso queda en el log y en su resultado.
 */
export const runClockTick = async (deps: ClockTickDeps = {}): Promise<StepResult[]> => {
  const now = deps.now ?? new Date();
  const steps: StepResult[] = [];
  try {
    // Primero una lectura (lo normal es que no toque nada); el turno solo se
    // intenta tomar si ya venció, y ahí el `UPDATE` decide quién gana.
    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: [CLOCK_SYNC_KEY, CLOCK_REMINDERS_KEY, CLOCK_FOLLOWUP_KEY, CLOCK_PENDING_KEY, CLOCK_EVENTS_KEY, CLOCK_NOSHOW_KEY, CLOCK_ARRIVAL_KEY, CLOCK_QUOTE_KEY] } },
      select: { key: true, value: true },
    });
    const due = (key: string, everyMs: number) =>
      clockSlotDue(parseClockValue(rows.find((r) => r.key === key)?.value), now.getTime(), everyMs);

    if (due(CLOCK_SYNC_KEY, CLOCK_SYNC_EVERY_MS) && (await claimClockSlot(CLOCK_SYNC_KEY, CLOCK_SYNC_EVERY_MS, now))) {
      steps.push(
        await step(
          "citas",
          deps.sync ??
            (async () => {
              const r = await syncAppointments();
              // Una sesión recién ligada por Meet la vuelve clienta: su estado al día ya.
              for (const id of r.meetLinkedChats) await computeSegment(id).catch(() => null);
              // Una llamada gratis que Dayana movió o borró en Google: ya no es «llamada agendada» (o es otro día).
              for (const id of r.bookingChats) await computeSegment(id).catch(() => null);
              return r;
            })
        )
      );
    }
    if (
      due(CLOCK_REMINDERS_KEY, CLOCK_REMINDERS_EVERY_MS) &&
      (await claimClockSlot(CLOCK_REMINDERS_KEY, CLOCK_REMINDERS_EVERY_MS, now))
    ) {
      const on = await areRemindersEnabled();
      steps.push(
        await step("recordatorios", async () => (on ? (deps.dayBefore ?? (() => sendDueReminders()))() : { off: true }))
      );
      steps.push(
        await step("recordatorio 1 h", async () => {
          if (!on) return { off: true };
          if (deps.soon) return deps.soon();
          const config = await getWhatsAppAiConfig();
          return config.freeCallReminder.enabled ? sendSoonReminders({ config }) : { off: true };
        })
      );
    }
    if (due(CLOCK_FOLLOWUP_KEY, CLOCK_FOLLOWUP_EVERY_MS) && (await claimClockSlot(CLOCK_FOLLOWUP_KEY, CLOCK_FOLLOWUP_EVERY_MS, now))) {
      steps.push(
        await step("seguimiento llamadas", async () => {
          const config = await getWhatsAppAiConfig();
          if (!config.callFollowUp.enabled) return { off: true };
          return (deps.followUp ?? ((c: WhatsAppAiConfig) => sweepCallOutcomes(c, now)))(config);
        })
      );
    }
    if (due(CLOCK_NOSHOW_KEY, CLOCK_NOSHOW_EVERY_MS) && (await claimClockSlot(CLOCK_NOSHOW_KEY, CLOCK_NOSHOW_EVERY_MS, now))) {
      steps.push(
        await step("sesiones sin asistir", async () => {
          const config = await getWhatsAppAiConfig();
          if (!config.noShow.enabled) return { off: true };
          return (deps.noShow ?? ((c: WhatsAppAiConfig) => sweepSessionNoShows(c, now)))(config);
        })
      );
    }
    if (due(CLOCK_ARRIVAL_KEY, CLOCK_ARRIVAL_EVERY_MS) && (await claimClockSlot(CLOCK_ARRIVAL_KEY, CLOCK_ARRIVAL_EVERY_MS, now))) {
      steps.push(
        await step("te esperan en la sala", async () => {
          const config = await getWhatsAppAiConfig();
          if (!config.sessionArrival.enabled) return { off: true };
          return (deps.arrival ?? ((c: WhatsAppAiConfig) => sweepSessionArrivals(c, now)))(config);
        })
      );
    }
    // Manda mensajes y recalcula estados: desde los webhooks, no desde el stream.
    if (!deps.light && due(CLOCK_QUOTE_KEY, CLOCK_QUOTE_EVERY_MS) && (await claimClockSlot(CLOCK_QUOTE_KEY, CLOCK_QUOTE_EVERY_MS, now))) {
      steps.push(
        await step("seguimiento cierre", async () => {
          const config = await getWhatsAppAiConfig();
          if (!config.quoteFollowUp.enabled) return { off: true };
          return (deps.quote ?? ((c: WhatsAppAiConfig) => sweepQuoteFollowUps(c, now)))(config);
        })
      );
    }
    // Los pesados: solo desde los webhooks (con `after()`), y uno por pasada.
    let heavy = false;
    if (!deps.light && due(CLOCK_PENDING_KEY, CLOCK_PENDING_EVERY_MS) && (await claimClockSlot(CLOCK_PENDING_KEY, CLOCK_PENDING_EVERY_MS, now))) {
      heavy = true;
      steps.push(
        await step(
          "pendientes",
          deps.pending ?? (() => answerUnansweredChats({ budgetMs: 90_000, minAgeMin: 5, recentRunMin: 30, limit: 8, concurrency: 4 }))
        )
      );
    }
    if (!deps.light && !heavy && due(CLOCK_EVENTS_KEY, CLOCK_EVENTS_EVERY_MS) && (await claimClockSlot(CLOCK_EVENTS_KEY, CLOCK_EVENTS_EVERY_MS, now))) {
      steps.push(await step("eventos", deps.events ?? (() => runEventsClock({ totalMs: 90_000, tailMs: 10_000 }))));
    }
  } catch (e) {
    console.warn("[reloj WhatsApp · avisos] no se pudo tomar el turno", e instanceof Error ? e.message : e);
  }
  if (steps.length) console.info(`[reloj WhatsApp · avisos] ${JSON.stringify(steps)}`);
  return steps;
};

/**
 * Solo la app de producción hace de reloj: una Preview o el `bun dev` local
 * comparten base con alguien más y no deben mandar recordatorios por su
 * cuenta (ahí se usa la ruta del cron a mano).
 */
export const isClockHost = (): boolean => process.env.VERCEL_ENV === "production";

/** Para las rutas (con `after()` o sin esperar): no hace nada fuera de producción y nunca lanza. */
export const piggybackClockTick = async (opts: { light?: boolean } = {}): Promise<void> => {
  if (!isClockHost()) return;
  await runClockTick({ light: opts.light === true }).catch(() => undefined);
};
