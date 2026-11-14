import { NextResponse } from "next/server";
import { GoogleService } from "@prisma/client";
import { z } from "zod";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  deleteGoogleAccount,
  getGoogleAccount,
  setGoogleAccountServices,
} from "@/lib/crm/google-accounts";
import {
  forgetAccountToken,
  GoogleNotConfiguredError,
  startAccountAuthorization,
} from "@/lib/google/connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

const patchSchema = z.object({
  services: z.array(z.enum(GoogleService)),
  /** «Volver a conectar con Google»: pide la URL aunque no se añada nada. */
  reauthorize: z.boolean().optional(),
});

/**
 * Cambia qué servicios expone una cuenta.
 *
 * Quitar un servicio es inmediato: el token deja de pedir ese scope. Añadirlo
 * no, porque un permiso ya concedido no gana scopes por sí solo — hay que
 * volver a pasar por Google. En ese caso se devuelve la URL nueva y la UI
 * manda allí al operador en vez de dejar una cuenta que dice tener Calendario
 * pero falla en cuanto se usa.
 *
 * `reauthorize: true` hace lo mismo sin cambiar servicios: es el botón de
 * reconectar de una cuenta caída (o de una conectada por Vercel Connect).
 */
export const PATCH = withStaff<Params>("owner", async ({ req, staff, params }) => {
  const { id } = params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("INVALID_BODY", 400);
  }

  const existing = await getGoogleAccount(id);
  if (!existing) return apiError("NOT_FOUND", 404);

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

  if (!needsReauthorization && !parsed.data.reauthorize) {
    return NextResponse.json({ account, url: null });
  }

  try {
    const url = await startAccountAuthorization({
      accountId: account.id,
      staffUserId: staff.id,
      services: account.services,
      loginHint: account.email,
    });
    return NextResponse.json({ account, url });
  } catch (error) {
    if (error instanceof GoogleNotConfiguredError) {
      return apiError("GOOGLE_NOT_CONFIGURED", 503, { detail: error.message });
    }
    console.error("[google re-authorize]", error);
    return apiError("AUTHORIZATION_START_FAILED", 502);
  }
});

/**
 * Desconecta la cuenta del CRM.
 *
 * Borra nuestra fila; el permiso en Google se revoca desde la cuenta de Google
 * (myaccount.google.com/permissions). Se dice así en la UI para no dar a
 * entender que esto lo revoca todo.
 */
export const DELETE = withStaff<Params>("owner", async ({ staff, params }) => {
  const { id } = params;
  const existing = await getGoogleAccount(id);
  if (!existing) return apiError("NOT_FOUND", 404);

  await deleteGoogleAccount(id);
  forgetAccountToken(id);

  fireAuditLog({
    staffUserId: staff.id,
    action: "GOOGLE_ACCOUNT_DISCONNECTED",
    entityType: "GoogleAccount",
    entityId: id,
    changes: { email: existing.email },
  });

  return NextResponse.json({ ok: true });
});
