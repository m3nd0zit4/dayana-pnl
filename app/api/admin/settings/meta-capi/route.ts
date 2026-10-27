import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  describeCapiToken,
  resolveCapiCredentials,
  setCapiToken,
} from "@/lib/meta/capi-credentials";
import {
  CAPI_TOKEN_INPUT_MESSAGES,
  checkCapiToken,
  parseCapiTokenInput,
} from "@/lib/meta/capi-token-input";

export const dynamic = "force-dynamic";

/**
 * Token de la Conversions API de Meta (las compras que se cuentan en los
 * anuncios). Solo la dueña. El token entra por aquí y no sale nunca: ni en
 * las respuestas, ni en la auditoría, ni en los registros. Lo único que se
 * devuelve es su huella.
 */

const audit = (staffUserId: string, changes: Record<string, unknown>) =>
  fireAuditLog({
    staffUserId,
    action: "UPDATE",
    entityType: "MetaCapiToken",
    entityId: "meta-capi-token",
    changes,
  });

export const GET = withStaff("owner", async () => {
  return NextResponse.json({ status: await describeCapiToken() });
});

const saveSchema = z.object({
  token: z.string().max(5000),
  /** El cliente ya vio el aviso de «no pude comprobarlo» y lo quiere igual. */
  force: z.boolean().optional(),
});

export const PUT = withStaff("owner", async ({ req, staff }) => {
  const body = saveSchema.safeParse(await readJson(req));
  if (!body.success) return apiError("invalid_body", 400);

  const parsed = parseCapiTokenInput(body.data.token);
  if (!parsed.ok) {
    return apiError("invalid_token_format", 422, {
      message: CAPI_TOKEN_INPUT_MESSAGES[parsed.issue],
    });
  }

  const check = await checkCapiToken(parsed.token);
  // Un token que Meta rechaza no se guarda: taparía el bueno del servidor y
  // las compras dejarían de contarse. Si Meta no contesta, se guarda igual.
  if (check.state === "invalid") {
    return apiError("token_rejected", 422, { message: check.message });
  }

  // Meta no contestó (o contestó algo que no habla del token): si ya hay uno
  // en uso, pisarlo a ciegas podría cortar las compras. Se pide confirmación.
  if (check.state === "unknown" && !body.data.force) {
    const current = await describeCapiToken();
    if (current.source !== null) {
      return apiError("unverified", 409, {
        message: `${check.message} Ya hay un token en uso: si lo guardas, lo reemplaza.`,
      });
    }
  }

  await setCapiToken(parsed.token);
  audit(staff.id, {
    replaced: true,
    metaCheck: check.state,
    ...(body.data.force ? { forced: true } : {}),
  });

  return NextResponse.json({
    status: await describeCapiToken(),
    check: check.state,
    message: check.state === "unknown" ? check.message : null,
  });
});

/** Quita el token guardado aquí; si el servidor tiene uno, vuelve a ese. */
export const DELETE = withStaff("owner", async ({ staff }) => {
  await setCapiToken(null);
  audit(staff.id, { removed: true });
  return NextResponse.json({ status: await describeCapiToken() });
});

const actionSchema = z.object({ action: z.literal("test") });

/** Comprueba con Meta el token que se usaría ahora. */
export const POST = withStaff("owner", async ({ req }) => {
  const body = actionSchema.safeParse(await readJson(req));
  if (!body.success) return apiError("invalid_body", 400);

  const credentials = await resolveCapiCredentials();
  if (!credentials) {
    // `resolveCapiCredentials` también devuelve null sin id de píxel: hay que
    // distinguirlo, o se le diría que no hay token teniéndolo.
    const status = await describeCapiToken();
    return apiError(status.source ? "no_pixel" : "no_token", 400);
  }

  const check = await checkCapiToken(credentials.token);
  return NextResponse.json({
    check: check.state,
    message: check.state === "valid" ? null : check.message,
    source: credentials.source,
  });
});
