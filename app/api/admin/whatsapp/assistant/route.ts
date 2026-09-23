import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { runOwnerAssistant } from "@/lib/crm/whatsapp-agent/owner-assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(6000),
      })
    )
    .min(1)
    .max(60),
});

/** Un turno del chat de Dayana con su asistente. Devuelve texto y propuestas. */
export const POST = withStaff("owner", async ({ req }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  if (!process.env.GEMINI_API_KEY?.trim()) return apiError("no_model_key", 503);
  try {
    return NextResponse.json(await runOwnerAssistant(parsed.data.messages));
  } catch (e) {
    console.error("[whatsapp assistant]", e);
    return apiError("assistant_failed", 502);
  }
});
