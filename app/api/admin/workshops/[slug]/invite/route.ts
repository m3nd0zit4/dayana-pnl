import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { canBroadcastNotifications } from "@/lib/crm/staff-permissions";
import {
  cancelWorkshopInvite,
  previewWorkshopInvite,
  processWorkshopInviteBatch,
  startWorkshopInvite,
  submitInviteTemplate,
} from "@/lib/crm/workshop-invite";
import { INVITE_SEND_KIND } from "@/lib/crm/workshop-invite-rules";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
// Una tanda de 10 personas, cada una recalculada (su estado, su agenda) y con su respiro, cabe de sobra.
export const maxDuration = 120;

type Params = { slug: string };

const count = z.number().int().min(0).max(100_000);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }),
  // Lo que Dayana vio y confirmó: si al empezar no cuadra, no se empieza.
  z.object({
    action: z.literal("start"),
    expect: z.object({ viaText: count, viaTemplate: count, includeTemplate: z.boolean() }),
  }),
  z.object({ action: z.literal("submit_template") }),
  z.object({ action: z.literal("next"), sendId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("cancel"), sendId: z.string().min(1).max(64) }),
]);

/**
 * «Invitar a inscritas de eventos gratuitos» (`workshop-invite.ts`):
 * - `preview`: a cuántas les llega y por qué a las demás no (no envía nada ni
 *   manda la plantilla a Meta);
 * - `start`: prepara el envío con lo confirmado (solo la dueña, como las
 *   campañas por correo); si falta la plantilla, la manda a aprobar;
 * - `submit_template`: manda la plantilla a aprobar (la dueña);
 * - `next`: la siguiente tanda (la página la pide hasta terminar);
 * - `cancel`: detiene lo que falta.
 */
export const POST = withStaff<Params>("write", async ({ req, staff, params }) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const edition = await prisma.workshopEdition.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!edition) return apiError("not_found", 404);
  const body = parsed.data;

  if (body.action === "preview") {
    const preview = await previewWorkshopInvite(edition.id);
    if (!preview) return apiError("not_found", 404);
    return NextResponse.json({ ...preview, canSend: canBroadcastNotifications(staff.role) });
  }

  // Enviar a muchas personas a la vez (o mandar su plantilla a Meta): solo la dueña.
  if (!canBroadcastNotifications(staff.role)) return apiError("forbidden", 403, { message: "Solo la dueña puede enviar la invitación." });

  if (body.action === "submit_template") {
    const result = await submitInviteTemplate();
    if (result.status === "failed") return apiError("template_failed", 502, { message: `Meta no recibió la plantilla: ${result.error}` });
    return NextResponse.json(result);
  }

  if (body.action === "start") {
    const result = await startWorkshopInvite({ editionId: edition.id, staffId: staff.id, expect: body.expect });
    if (result.status === "blocked") return apiError("send_blocked", 400, { message: result.message });
    if (result.status === "changed") return apiError("preview_changed", 409, { message: result.message });
    return NextResponse.json(result);
  }

  // La tanda o la cancelación tienen que ser de una invitación de ESTE taller.
  const send = await prisma.whatsAppSend.findUnique({ where: { id: body.sendId }, select: { kind: true, workshopEditionId: true } });
  if (!send || send.kind !== INVITE_SEND_KIND || send.workshopEditionId !== edition.id) return apiError("not_found", 404);

  if (body.action === "cancel") {
    await cancelWorkshopInvite({ sendId: body.sendId, staffId: staff.id });
    return NextResponse.json({ ok: true });
  }
  try {
    return NextResponse.json(await processWorkshopInviteBatch({ sendId: body.sendId, staffId: staff.id }));
  } catch (e) {
    return apiError("send_failed", 400, { message: e instanceof Error ? e.message : "No se pudo seguir con el envío." });
  }
});
