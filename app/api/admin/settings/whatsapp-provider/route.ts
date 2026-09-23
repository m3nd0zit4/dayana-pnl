import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { getSiteUrl } from "@/lib/site-url";
import {
  Dialog360Error,
  getWhatsAppProviderSummary,
  registerDialog360Webhook,
  saveWhatsAppProvider,
  testDialog360Connection,
} from "@/lib/meta/whatsapp-provider";

export const dynamic = "force-dynamic";

/** Estado del proveedor. Nunca devuelve la clave, solo su huella. */
export const GET = withStaff("owner", async () => {
  return NextResponse.json({ summary: await getWhatsAppProviderSummary() });
});

const saveSchema = z.object({
  provider: z.enum(["meta", "dialog360"]),
  apiKey: z.string().trim().max(400).optional().nullable(),
});

export const PATCH = withStaff("owner", async ({ req, staff }) => {
  const parsed = saveSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);

  await saveWhatsAppProvider(parsed.data);

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WhatsAppProvider",
    entityId: "whatsapp-provider",
    // Solo si cambió la clave, nunca la clave.
    changes: { provider: parsed.data.provider, apiKeyChanged: Boolean(parsed.data.apiKey) },
  });

  return NextResponse.json({ summary: await getWhatsAppProviderSummary() });
});

const actionSchema = z.object({ action: z.enum(["test", "register-webhook"]) });

/** Probar la clave o registrar la URL de avisos en 360dialog. */
export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = actionSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);

  try {
    if (parsed.data.action === "test") {
      const result = await testDialog360Connection();
      return NextResponse.json({ ok: true, ...result });
    }

    const url = await registerDialog360Webhook(getSiteUrl());
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "WhatsAppProvider",
      entityId: "whatsapp-provider",
      changes: { webhookRegistered: url },
    });
    return NextResponse.json({ ok: true, webhookUrl: url });
  } catch (e) {
    if (e instanceof Dialog360Error) {
      return NextResponse.json(
        { error: "dialog360_error", message: e.message },
        { status: e.status === 401 ? 400 : 502 }
      );
    }
    throw e;
  }
});
