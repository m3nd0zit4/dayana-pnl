import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createEvent, updateEvent } from "@/lib/google/calendar";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";
import { accountLabel, resolveGoogleAccount } from "@/agent/lib/google";

/**
 * Sesión de terapia → evento de Google Calendar.
 *
 * Es la única tool que escribe en las dos direcciones: crea (o actualiza) el
 * evento y devuelve a la sesión su `googleEventId` y el enlace de Meet. Guardar
 * el id del evento es lo que hace que volver a sincronizar mueva el evento
 * existente en vez de dejar dos citas a horas distintas en el calendario.
 */
export default defineTool({
  description:
    "Put a scheduled therapy session on Google Calendar, or move the existing event if it was synced before. Also fills the session's Meet link when it has none. The session must already have a date — schedule it first with schedule_therapy_session. Inviting the client emails them the invitation, so ask the operator before passing inviteContact.",
  inputSchema: z.object({
    sessionId: z.string().min(1).describe("Id de la sesión, de get_therapy_package."),
    inviteContact: z
      .boolean()
      .optional()
      .describe(
        "Invita al cliente por correo. Requiere que el contacto tenga email."
      ),
    withMeet: z
      .boolean()
      .optional()
      .describe("Crea un enlace de Meet si la sesión aún no tiene uno."),
    accountId: z.string().optional(),
  }),
  approval: always(),
  async execute({ sessionId, inviteContact, withMeet, accountId }, ctx) {
    requireWriteStaff(ctx);

    const session = await prisma.therapySession.findUnique({
      where: { id: sessionId },
      include: {
        therapyPackage: {
          include: {
            enrollment: {
              include: { contact: true, product: true },
            },
          },
        },
      },
    });

    if (!session) throw new Error("Esa sesión de terapia no existe.");
    if (!session.scheduledAt) {
      throw new Error(
        "Esa sesión todavía no tiene fecha. Agéndala primero con schedule_therapy_session."
      );
    }

    const contact = session.therapyPackage.enrollment.contact;
    if (inviteContact && !contact.email) {
      throw new Error(
        `${contact.firstName} no tiene correo registrado, así que no puedo invitarle. Sincroniza sin invitación o añade su correo primero.`
      );
    }

    const start = session.scheduledAt;
    const end = new Date(start.getTime() + session.durationMinutes * 60_000);
    const clientName = contact.displayName ?? `${contact.firstName} ${contact.lastName ?? ""}`.trim();

    const { account, token } = await resolveGoogleAccount("CALENDAR", accountId);

    const payload = {
      summary: `Terapia · ${clientName} (sesión ${session.sessionNumber})`,
      description: [
        session.therapyPackage.enrollment.product.title,
        `Contacto: ${clientName} — ${contact.phoneE164}`,
        `CRM: /admin/contacts/${contact.id}`,
      ].join("\n"),
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      timeZone: contact.timezone || "America/Bogota",
      ...(inviteContact && contact.email ? { attendeeEmails: [contact.email] } : {}),
      // No se pide Meet si la sesión ya tiene enlace: se perdería el que el
      // operador puso a mano y los clientes ya podrían tenerlo.
      withMeet: Boolean(withMeet) && !session.meetUrl,
    };

    const existing = session.googleEventId;
    const event = existing
      ? await updateEvent(token, existing, payload)
      : await createEvent(token, payload);

    const updated = await prisma.therapySession.update({
      where: { id: sessionId },
      data: {
        googleEventId: event.id,
        ...(event.hangoutLink && !session.meetUrl
          ? { meetUrl: event.hangoutLink }
          : {}),
      },
      select: { id: true, googleEventId: true, meetUrl: true },
    });

    await auditAgentWrite(ctx, {
      action: existing ? "GOOGLE_CALENDAR_SESSION_UPDATED" : "GOOGLE_CALENDAR_SESSION_CREATED",
      entityType: "TherapySession",
      entityId: sessionId,
      changes: {
        account: accountLabel(account),
        eventId: event.id,
        scheduledAt: start.toISOString(),
        invited: Boolean(inviteContact),
      },
    });

    return {
      sessionId: updated.id,
      eventId: updated.googleEventId,
      account: accountLabel(account),
      action: existing ? "updated" : "created",
      link: event.htmlLink ?? null,
      meetUrl: updated.meetUrl,
      invited: inviteContact ? contact.email : null,
    };
  },
});
