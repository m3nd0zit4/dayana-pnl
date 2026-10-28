import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { canBroadcastNotifications } from "@/lib/crm/staff-permissions";
import {
  cancelWorkshopInvite,
  previewWorkshopInvite,
  processWorkshopInviteBatch,
  startWorkshopInvite,
} from "@/lib/crm/workshop-invite";
import { INVITE_SEND_KIND } from "@/lib/crm/workshop-invite-rules";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
// Una tanda de 10 personas, cada una recalculada (su estado, su agenda) y con su respiro, cabe de sobra.
export const maxDuration = 120;

type Params = { slug: string };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("next"), sendId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("cancel"), sendId: z.string().min(1).max(64) }),
]);

/**
 * «Invitar a inscritas de eventos gratuitos» (`workshop-invite.ts`):
 * - `preview`: a cuántas les llega y por qué a las demás no (no envía nada);
 * - `start`: prepara el envío (solo la dueña, como las campañas por correo);
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

  // Enviar a muchas personas a la vez: solo la dueña (como «Avisar por correo»).
  if (!canBroadcastNotifications(staff.role)) return apiError("forbidden", 403, { message: "Solo la dueña puede enviar la invitación." });

  if (body.action === "start") {
    const result = await startWorkshopInvite({ editionId: edition.id, staffId: staff.id });
    if (result.status === "blocked") return apiError("send_blocked", 400, { message: result.message });
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
