import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  activateGoogleAccount,
  getGoogleAccount,
} from "@/lib/crm/google-accounts";
import { resolveAccountIdentity } from "@/lib/google/connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vuelta del consentimiento de Google.
 *
 * Aquí llega un navegador, no un cliente de API, así que siempre se redirige a
 * la pantalla de ajustes con un parámetro legible — mismo criterio que el
 * callback de TikTok.
 *
 * No se confía en ningún parámetro que traiga la redirección para decidir si
 * hubo consentimiento: se pide un token de verdad. Si Connect lo entrega, el
 * permiso existe; si no, no lo hay, diga lo que diga la URL.
 */
const back = (req: Request, params: Record<string, string>) =>
  NextResponse.redirect(
    new URL(`/admin/ajustes/google?${new URLSearchParams(params)}`, req.url)
  );

export const GET = async (req: Request) => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return back(req, { google: "invalid" });

  const account = await getGoogleAccount(accountId);
  if (!account) return back(req, { google: "not_found" });

  try {
    const identity = await resolveAccountIdentity(
      account.connectSubject,
      account.services
    );
    const activated = await activateGoogleAccount(accountId, identity);

    fireAuditLog({
      staffUserId: staff.id,
      action: "GOOGLE_ACCOUNT_CONNECTED",
      entityType: "GoogleAccount",
      entityId: activated.id,
      changes: { email: activated.email, services: activated.services },
    });

    return back(req, { google: "connected" });
  } catch (error) {
    console.error("[google callback]", error);
    return back(req, { google: "denied" });
  }
};
