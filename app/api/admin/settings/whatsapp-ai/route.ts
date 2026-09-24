import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { deepMerge } from "@/lib/crm/whatsapp-agent/config-patch";
import { prisma } from "@/lib/db";
import {
  getWhatsAppAiConfig,
  setWhatsAppAiConfig,
  whatsAppAiConfigSchema,
} from "@/lib/crm/whatsapp-ai-config";
import {
  draftAutoReply,
  isWhatsAppAutoReplyEnabled,
  setWhatsAppAutoReplyEnabled,
} from "@/lib/crm/whatsapp-autoreply";
import {
  draftStyleGuide,
  getLearningSummary,
  importExamples,
  learnFromInbox,
  listExamples,
} from "@/lib/crm/whatsapp-learning";

export const dynamic = "force-dynamic";
// Aprender del historial calcula vectores por tandas.
export const maxDuration = 300;

/** Configuración del asistente de WhatsApp y lo que ha aprendido. */
export const GET = withStaff("owner", async () => {
  const [config, enabled, summary] = await Promise.all([
    getWhatsAppAiConfig(),
    isWhatsAppAutoReplyEnabled(),
    getLearningSummary(),
  ]);
  return NextResponse.json({ config, enabled, summary });
});

// `patch` (solo lo que cambió) se mezcla sobre la configuración ACTUAL de la
// base. `config` completo se acepta por compatibilidad, pero ya no lo manda el CRM.
const saveSchema = z.object({
  enabled: z.boolean().optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
  config: whatsAppAiConfigSchema.optional(),
});

export const PATCH = withStaff("owner", async ({ req, staff }) => {
  const parsed = saveSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);

  let config = parsed.data.config ?? null;
  if (!config && parsed.data.patch) {
    const merged = whatsAppAiConfigSchema.safeParse(deepMerge(await getWhatsAppAiConfig(), parsed.data.patch));
    if (!merged.success) return apiError("invalid_config", 400);
    config = merged.data;
  }
  await Promise.all([
    config ? setWhatsAppAiConfig(config) : Promise.resolve(),
    parsed.data.enabled !== undefined ? setWhatsAppAutoReplyEnabled(parsed.data.enabled) : Promise.resolve(),
  ]);

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WhatsAppAi",
    entityId: "whatsapp-ai",
    changes: {
      enabled: parsed.data.enabled,
      patch: parsed.data.patch ? Object.keys(parsed.data.patch) : "config",
    },
  });

  return NextResponse.json({ ok: true });
});

const pairSchema = z.object({
  clientText: z.string().trim().min(1).max(1300),
  replyText: z.string().trim().min(1).max(1600),
  replyKey: z.string().max(80),
  repliedAt: z.coerce.date(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("learn"), cursor: z.string().nullable() }),
  z.object({ action: z.literal("style") }),
  z.object({
    action: z.literal("preview"),
    message: z.string().trim().min(1).max(1500),
    config: whatsAppAiConfigSchema.optional(),
  }),
  z.object({
    action: z.literal("import"),
    pairs: z.array(pairSchema).min(1).max(2000),
  }),
  z.object({
    action: z.literal("list"),
    q: z.string().max(100).optional(),
    page: z.number().int().min(1).max(10000).optional(),
  }),
  z.object({
    action: z.literal("toggle"),
    id: z.string().min(1),
    isEnabled: z.boolean(),
  }),
  z.object({ action: z.literal("delete"), id: z.string().min(1) }),
]);

export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = actionSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const input = parsed.data;

  switch (input.action) {
    case "learn": {
      const result = await learnFromInbox(input.cursor);
      return NextResponse.json({
        ...result,
        summary: await getLearningSummary(),
      });
    }

    case "style": {
      try {
        return NextResponse.json({ styleGuide: await draftStyleGuide() });
      } catch (e) {
        const reason = e instanceof Error ? e.message : "error";
        return NextResponse.json(
          {
            error: reason,
            message:
              reason === "not_enough_examples"
                ? "Aún no hay suficientes conversaciones aprendidas (mínimo 5)."
                : "No se pudo generar la guía. Intenta de nuevo.",
          },
          { status: 400 }
        );
      }
    }

    case "preview": {
      // Exactamente lo que saldría, sin enviar nada. Con la configuración que
      // está en pantalla (aunque no se haya guardado) para poder probar antes.
      const config = input.config ?? (await getWhatsAppAiConfig());
      const draft = await draftAutoReply({
        config,
        transcript: [{ direction: "INBOUND", body: input.message }],
        name: null,
      });
      return NextResponse.json({ draft });
    }

    case "import": {
      const result = await importExamples(input.pairs);
      fireAuditLog({
        staffUserId: staff.id,
        action: "CREATE",
        entityType: "WhatsAppReplyExample",
        entityId: "import",
        changes: { pairs: input.pairs.length, written: result.written },
      });
      return NextResponse.json({
        ...result,
        summary: await getLearningSummary(),
      });
    }

    case "list":
      return NextResponse.json(
        await listExamples({ q: input.q, page: input.page })
      );

    case "toggle":
      await prisma.whatsAppReplyExample.update({
        where: { id: input.id },
        data: { isEnabled: input.isEnabled },
      });
      return NextResponse.json({ ok: true });

    case "delete":
      await prisma.whatsAppReplyExample.delete({ where: { id: input.id } });
      return NextResponse.json({ ok: true });
  }
});
