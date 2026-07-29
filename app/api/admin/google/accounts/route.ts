import { NextResponse } from "next/server";
import { GoogleService } from "@prisma/client";
import { z } from "zod";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
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

export const GET = async () => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  return NextResponse.json({
    enabled: isGoogleEnabled(),
    accounts: await listGoogleAccounts(),
  });
};

const createSchema = z.object({
  services: z.array(z.enum(GoogleService)).min(1),
});

export const POST = async (req: Request) => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
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
      return NextResponse.json(
        { error: "GOOGLE_NOT_CONFIGURED", detail: error.message },
        { status: 503 }
      );
    }

    console.error("[google connect]", error);
    fireAuditLog({
      staffUserId: staff.id,
      action: "GOOGLE_ACCOUNT_CONNECT_FAILED",
      entityType: "GoogleAccount",
      entityId: account.id,
      changes: { message: error instanceof Error ? error.message : "unknown" },
    });
    return NextResponse.json({ error: "AUTHORIZATION_START_FAILED" }, { status: 502 });
  }
};
