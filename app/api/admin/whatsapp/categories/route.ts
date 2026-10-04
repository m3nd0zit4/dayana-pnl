import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import {
  categoryCounts,
  classifyConversation,
  classifyPending,
  clearManualCategory,
  setClassifyEnabled,
  setManualCategory,
  setTeamPhones,
  type ClassifyRunResult,
} from "@/lib/crm/chat-category";
import { CHAT_CATEGORIES } from "@/lib/crm/chat-category-rules";
import { categoryChangeNeedsOwner } from "@/lib/crm/whatsapp-category-filter";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** «Clasificar todo» trabaja como mucho esto por llamada; la pantalla repite hasta terminar. */
const CLASSIFY_ALL_BUDGET_MS = 50_000;

/**
 * Cuántos chats hay de cada categoría, cuántos por revisar y cuántos sin
 * clasificar. Los números del equipo, solo a la dueña (al resto, vacío).
 */
export const GET = withStaff("read", async ({ staff }) => {
  const counts = await categoryCounts();
  return NextResponse.json({ ...counts, teamPhones: staff.role === "OWNER" ? counts.teamPhones : [] });
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("classify_all") }),
  z.object({
    action: z.literal("set"),
    conversationId: z.string().min(1),
    /** `null` quita la marca manual y el chat vuelve a clasificarse solo. */
    category: z.enum(CHAT_CATEGORIES).nullable(),
  }),
  z.object({ action: z.literal("reclassify"), conversationId: z.string().min(1) }),
  z.object({ action: z.literal("team_phones"), phones: z.array(z.string().max(40)).max(50) }),
  z.object({ action: z.literal("enable"), enabled: z.boolean() }),
]);

const sum = (a: ClassifyRunResult, b: ClassifyRunResult): ClassifyRunResult => ({
  processed: a.processed + b.processed,
  classified: a.classified + b.classified,
  byRule: a.byRule + b.byRule,
  byAi: a.byAi + b.byAi,
  kept: a.kept + b.kept,
  review: a.review + b.review,
  needsAi: a.needsAi + b.needsAi,
  failed: a.failed + b.failed,
  skipped: a.skipped + b.skipped,
  remaining: b.remaining,
  models: [...new Set([...a.models, ...b.models])],
  aiBlocked: a.aiBlocked ?? b.aiBlocked,
  aiDisabled: a.aiDisabled || b.aiDisabled,
  busy: b.busy,
  retryAfterMs: b.retryAfterMs,
  ms: a.ms + b.ms,
  errors: [...a.errors, ...b.errors].slice(0, 5),
});

/**
 * - `classify_all` (solo la dueña: gasta la IA): clasifica tandas hasta ~50 s y dice cuánto falta; la
 *   pantalla vuelve a llamar mientras `done` sea false. Con la clasificación
 *   apagada, solo reglas (`aiDisabled`). `busy`: otra tanda (el reloj) tiene
 *   el arriendo; la pantalla DEBE esperar `retryAfterMs` antes de reintentar
 *   (también va en la cabecera `Retry-After`).
 * - `set`: categoría manual (gana siempre) o `null` para volver a automático.
 *   Callar un chat (personal, negocio/app, equipo) o quitarle esa marca a
 *   mano decide si la IA contesta: solo la dueña. Lo demás, quien pueda escribir.
 * - `reclassify` (solo la dueña: gasta la IA): vuelve a mirar un chat (no toca los manuales).
 * - `team_phones` (solo la dueña): los números del equipo (sus chats pasan a
 *   «equipo»). 400 `invalid_phones` con los que no traen código de país.
 * - `enable` (solo la dueña): enciende o apaga la clasificación automática y
 *   el uso de la IA (apagada por defecto).
 */
export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const body = parsed.data;

  if (body.action === "set") {
    if (staff.role !== "OWNER") {
      const current = await prisma.conversation.findFirst({
        where: { id: body.conversationId, channel: "WHATSAPP" },
        select: { category: true, categorySource: true },
      });
      if (!current) return apiError("not_found", 404);
      if (categoryChangeNeedsOwner(current, body.category)) {
        return apiError("forbidden", 403, { message: "Solo la dueña puede callar un chat o quitarle esa marca." });
      }
    }
    if (body.category === null) {
      const outcome = await clearManualCategory(body.conversationId, staff.id);
      if (!outcome) return apiError("not_found", 404);
      return NextResponse.json({ ok: true, outcome });
    }
    const updated = await setManualCategory(body.conversationId, body.category, staff.id);
    if (!updated) return apiError("not_found", 404);
    return NextResponse.json({ ok: true, conversation: updated });
  }

  // Lo que puede silenciar chats o mandar conversaciones a la IA: solo la dueña.
  if (staff.role !== "OWNER") return apiError("forbidden", 403, { message: "Solo la dueña puede hacer esto." });

  if (body.action === "reclassify") {
    const outcome = await classifyConversation(body.conversationId, { force: true });
    if (outcome.status === "skipped" && outcome.reason === "not_found") return apiError("not_found", 404);
    return NextResponse.json({ ok: outcome.status !== "error", outcome });
  }

  if (body.action === "classify_all") {
    const started = Date.now();
    let total: ClassifyRunResult | null = null;
    let done = false;
    while (Date.now() - started < CLASSIFY_ALL_BUDGET_MS) {
      const run = await classifyPending({
        limit: 20,
        budgetMs: CLASSIFY_ALL_BUDGET_MS - (Date.now() - started),
      });
      total = total ? sum(total, run) : run;
      if (run.busy) break;
      // Sin pendientes, sin avances (solo dudosos que esperan a la IA) o con
      // la IA cortada (facturación, clave, cuota): listo por ahora.
      if (run.remaining === 0 || run.classified === 0 || run.aiBlocked) {
        done = true;
        break;
      }
    }
    const payload = { ok: true, done, ...total, counts: await categoryCounts() };
    return total?.busy
      ? NextResponse.json(payload, { headers: { "Retry-After": String(Math.ceil((total.retryAfterMs ?? 15_000) / 1000)) } })
      : NextResponse.json(payload);
  }

  if (body.action === "enable") {
    return NextResponse.json({ ok: true, enabled: await setClassifyEnabled(body.enabled, staff.id) });
  }

  const result = await setTeamPhones(body.phones, staff.id);
  if (!result.ok) return apiError("invalid_phones", 400, { invalid: result.invalid });
  return NextResponse.json(result);
});
