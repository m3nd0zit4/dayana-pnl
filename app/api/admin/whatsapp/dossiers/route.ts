import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { countStaleDossiers, refreshStaleDossiers } from "@/lib/crm/whatsapp-agent/dossier";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** «Construir fichas» trabaja como mucho esto por llamada; la pantalla repite hasta terminar. */
const BUILD_BUDGET_MS = 55_000;

/** Cuántas fichas faltan o están viejas. */
export const GET = withStaff("read", async () => NextResponse.json({ pending: await countStaleDossiers() }));

const bodySchema = z.object({ action: z.literal("build") });

/**
 * Arma o pone al día las fichas (las del chat más reciente primero) durante
 * ~55 s y dice cuántas faltan. Después de importar chats del celular, la
 * pantalla lo llama hasta que no quede ninguna.
 */
export const POST = withStaff("owner", async ({ req }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_request", 400);
  if (!process.env.GEMINI_API_KEY?.trim()) return apiError("no_model_key", 503);
  const run = await refreshStaleDossiers(BUILD_BUDGET_MS, { limit: 60 });
  return NextResponse.json({ ...run, pending: await countStaleDossiers() });
});
