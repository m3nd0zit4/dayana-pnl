import { NextResponse } from "next/server";
import { GoogleService } from "@prisma/client";
import { z } from "zod";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createPendingGoogleAccount,
  deleteGoogleAccount,
  listGoogleAccounts,
} from "@/lib/crm/google-accounts";
import {
  GoogleNotConfiguredError,
  isGoogleEnabled,
  startAccountAuthorization,
} from "@/lib/google/connect";
import { googleCallbackUrl } from "../callback-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conectar una cuenta de Google entrega al agente el calendario y la agenda
 * reales de una persona, así que es OWNER y no operador — misma línea que
 * `/api/admin/social/tiktok/connect`.
 */

export const GET = withStaff("owner", async () => {
  return NextResponse.json({
    enabled: isGoogleEnabled(),
    accounts: await listGoogleAccounts(),
  });
});

const createSchema = z.object({
  services: z.array(z.enum(GoogleService)).min(1),
});

export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("INVALID_BODY", 400);
  }

  const account = await createPendingGoogleAccount({
    services: parsed.data.services,
    staffUserId: staff.id,
  });

  try {
    const url = await startAccountAuthorization({
      connectSubject: account.connectSubject,
      services: parsed.data.services,
      callbackUrl: googleCallbackUrl(req, account.id),
    });

    return NextResponse.json({ accountId: account.id, url });
  } catch (error) {
    // La fila pendiente solo existe para sostener el sujeto de este
    // consentimiento. Si el consentimiento ni siquiera arrancó, dejarla
    // llenaría la pantalla de cuentas fantasma que no se pueden conectar.
    await deleteGoogleAccount(account.id).catch(() => undefined);

    if (error instanceof GoogleNotConfiguredError) {
      return apiError("GOOGLE_NOT_CONFIGURED", 503, { detail: error.message });
    }

    console.error("[google connect]", error);
    fireAuditLog({
      staffUserId: staff.id,
      action: "GOOGLE_ACCOUNT_CONNECT_FAILED",
      entityType: "GoogleAccount",
      entityId: account.id,
      changes: { message: error instanceof Error ? error.message : "unknown" },
    });
    return apiError("AUTHORIZATION_START_FAILED", 502);
  }
});
