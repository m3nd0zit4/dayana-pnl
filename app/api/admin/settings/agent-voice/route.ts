import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { providerFor } from "@/lib/voice/calls/providers";
import { placeOwnerCall } from "@/lib/voice/calls/owner-call";
import { sendOwnerVoiceNote } from "@/lib/voice/owner-voice-note";
import { getAgentVoiceSettings, ownerPhoneProblem, saveAgentVoiceSettings } from "@/lib/voice/settings";
import { CALL_PROVIDERS, normalizePhone, type CallProviderId } from "@/lib/voice/settings-rules";

/**
 * Voz del asistente (Ajustes → Canales del agente), solo OWNER.
 * GET: ajustes + qué le falta a cada proveedor de llamadas (nombres de
 * variables, nunca valores). PATCH: guardar. POST: probar (una nota de voz o
 * una llamada a su propio número).
 */

const callStatus = () =>
  (CALL_PROVIDERS.filter((p) => p !== "off") as Exclude<CallProviderId, "off">[]).map((id) => ({ id, missing: providerFor(id).missing() }));

export const GET = withStaff("owner", async () =>
  NextResponse.json({ settings: await getAgentVoiceSettings(), providers: callStatus() })
);

const PatchBody = z.object({
  ownerPhone: z.string().max(32).nullable().optional(),
  voiceNotes: z.boolean().optional(),
  voiceNotesProactive: z.boolean().optional(),
  calls: z.enum(CALL_PROVIDERS as [CallProviderId, ...CallProviderId[]]).optional(),
  quietStartHour: z.number().int().min(0).max(24).optional(),
  quietEndHour: z.number().int().min(0).max(24).optional(),
});

export const PATCH = withStaff("owner", async ({ req, staff }) => {
  const parsed = PatchBody.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const current = await getAgentVoiceSettings();
  const body = parsed.data;
  let ownerPhone = current.ownerPhone;
  if (body.ownerPhone !== undefined) {
    if (body.ownerPhone === null || body.ownerPhone.trim() === "") ownerPhone = null;
    else {
      ownerPhone = normalizePhone(body.ownerPhone);
      if (!ownerPhone) return apiError("Número inválido: escríbelo con el indicativo del país, p. ej. +57 300 123 4567.", 400);
      const problem = await ownerPhoneProblem(ownerPhone);
      if (problem) return apiError(problem, 400);
    }
  }
  const saved = await saveAgentVoiceSettings({ ...current, ...body, ownerPhone });
  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "SiteSetting",
    entityId: "agent.voice",
    changes: { ...saved, ownerPhone: saved.ownerPhone ? `…${saved.ownerPhone.slice(-4)}` : null },
  });
  return NextResponse.json({ settings: saved, providers: callStatus() });
});

const PostBody = z.object({ action: z.enum(["test_voice_note", "test_call"]) });

export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = PostBody.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  if (parsed.data.action === "test_voice_note") {
    const result = await sendOwnerVoiceNote({
      text: "Hola Dayana, soy tu asistente. Esta es una nota de voz de prueba desde el CRM. Si la escuchas, todo quedó bien conectado.",
      reason: "test",
      source: "ajustes",
      staffUserId: staff.id,
    });
    return NextResponse.json(result.sent ? { ok: true, seconds: Math.round(result.seconds), dryRun: result.dryRun } : { ok: false, error: result.detail });
  }
  const result = await placeOwnerCall({
    message: "Esta es una llamada de prueba. Dime cualquier cosa y te la dejo en el panel.",
    reason: "request",
    source: "ajustes",
    staffUserId: staff.id,
  });
  return NextResponse.json(result.placed ? { ok: true, simulated: result.simulated } : { ok: false, error: result.detail });
});
