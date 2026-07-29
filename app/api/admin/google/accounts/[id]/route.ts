import { NextResponse } from "next/server";
import { GoogleService } from "@prisma/client";
import { z } from "zod";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  deleteGoogleAccount,
  getGoogleAccount,
  setGoogleAccountServices,
} from "@/lib/crm/google-accounts";
import {
  GoogleNotConfiguredError,
  startAccountAuthorization,
} from "@/lib/google/connect";
import { googleCallbackUrl } from "../../callback-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  services: z.array(z.enum(GoogleService)),
});

/**
 * Cambia qué servicios expone una cuenta.
 *
 * Quitar un servicio es inmediato: el token deja de pedir ese scope. Añadirlo
 * no, porque un permiso ya concedido no gana scopes por sí solo — hay que
 * volver a pasar por Google. En ese caso se devuelve la URL nueva y la UI
 * manda allí al operador en vez de dejar una cuenta que dice tener Calendario
 * pero falla en cuanto se usa.
 */
export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const existing = await getGoogleAccount(id);
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const { account, needsReauthorization } = await setGoogleAccountServices(
    id,
    parsed.data.services
  );

  fireAuditLog({
    staffUserId: staff.id,
    action: "GOOGLE_ACCOUNT_SERVICES_UPDATED",
    entityType: "GoogleAccount",
    entityId: account.id,
    changes: { from: existing.services, to: account.services },
  });

  if (!needsReauthorization) {
    return NextResponse.json({ account, url: null });
  }

  try {
    const url = await startAccountAuthorization({
      connectSubject: account.connectSubject,
      services: account.services,
      callbackUrl: googleCallbackUrl(req, account.id),
    });
    return NextResponse.json({ account, url });
  } catch (error) {
    if (error instanceof GoogleNotConfiguredError) {
      return NextResponse.json(
        { error: "GOOGLE_NOT_CONFIGURED", detail: error.message },
        { status: 503 }
      );
    }
    console.error("[google re-authorize]", error);
    return NextResponse.json({ error: "AUTHORIZATION_START_FAILED" }, { status: 502 });
  }
};

/**
 * Desconecta la cuenta del CRM.
 *
 * Borra nuestra fila; el permiso en Google se revoca desde la cuenta de Google
 * (myaccount.google.com/permissions). Se dice así en la UI para no dar a
 * entender que esto lo revoca todo.
 */
export const DELETE = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const existing = await getGoogleAccount(id);
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await deleteGoogleAccount(id);

  fireAuditLog({
    staffUserId: staff.id,
    action: "GOOGLE_ACCOUNT_DISCONNECTED",
    entityType: "GoogleAccount",
    entityId: id,
    changes: { email: existing.email },
  });

  return NextResponse.json({ ok: true });
};
