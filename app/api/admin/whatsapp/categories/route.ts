import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import {
  categoryCounts,
  classifyConversation,
  classifyPending,
  clearManualCategory,
  setManualCategory,
  setTeamPhones,
  type ClassifyRunResult,
} from "@/lib/crm/chat-category";
import { CHAT_CATEGORIES } from "@/lib/crm/chat-category-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** «Clasificar todo» trabaja como mucho esto por llamada; la pantalla repite hasta terminar. */
const CLASSIFY_ALL_BUDGET_MS = 50_000;

/** Cuántos chats hay de cada categoría, cuántos por revisar y cuántos sin clasificar. */
export const GET = withStaff("read", async () => NextResponse.json(await categoryCounts()));

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
  ms: a.ms + b.ms,
  errors: [...a.errors, ...b.errors].slice(0, 5),
});

/**
 * - `classify_all`: clasifica tandas hasta ~50 s y dice cuánto falta; la
 *   pantalla vuelve a llamar mientras `done` sea false.
 * - `set`: categoría manual (gana siempre) o `null` para volver a automático.
 * - `reclassify`: vuelve a mirar un chat (no toca los manuales).
 * - `team_phones`: los números del equipo (sus chats pasan a «equipo»).
 */
export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const body = parsed.data;

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
      // Sin avances (solo quedan dudosos sin IA o fallos) o sin pendientes: listo.
      if (run.remaining === 0 || run.classified === 0) {
        done = true;
        break;
      }
    }
    return NextResponse.json({ ok: true, done, ...total, counts: await categoryCounts() });
  }

  if (body.action === "set") {
    if (body.category === null) {
      const outcome = await clearManualCategory(body.conversationId, staff.id);
      if (!outcome) return apiError("not_found", 404);
      return NextResponse.json({ ok: true, outcome });
    }
    const updated = await setManualCategory(body.conversationId, body.category, staff.id);
    if (!updated) return apiError("not_found", 404);
    return NextResponse.json({ ok: true, conversation: updated });
  }

  if (body.action === "reclassify") {
    const outcome = await classifyConversation(body.conversationId, { force: true });
    if (outcome.status === "skipped" && outcome.reason === "not_found") return apiError("not_found", 404);
    return NextResponse.json({ ok: outcome.status !== "error", outcome });
  }

  const result = await setTeamPhones(body.phones, staff.id);
  return NextResponse.json({ ok: true, ...result });
});
