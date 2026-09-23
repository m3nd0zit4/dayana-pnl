import { NextResponse } from "next/server";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  getWelcomeConfig,
  setWelcomeConfig,
  welcomeConfigSchema,
} from "@/lib/crm/whatsapp-welcome";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () => {
  return NextResponse.json({ config: await getWelcomeConfig() });
});

export const PATCH = withStaff("owner", async ({ req, staff }) => {
  const parsed = welcomeConfigSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);

  // El botón abre un enlace en el teléfono de una clienta: solo https, y solo
  // si trae etiqueta. Media configuración deja un botón roto en el saludo.
  const { buttonLabel, buttonUrl } = parsed.data;
  if (buttonUrl && !/^https:\/\//i.test(buttonUrl)) {
    return apiError("invalid_url", 400);
  }
  if (Boolean(buttonLabel) !== Boolean(buttonUrl)) {
    return apiError("incomplete_button", 400);
  }

  await setWelcomeConfig(parsed.data);

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WhatsAppWelcome",
    entityId: "whatsapp-welcome",
    changes: { isActive: parsed.data.isActive },
  });

  return NextResponse.json({ config: parsed.data });
});
