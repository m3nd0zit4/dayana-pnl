import crypto from "crypto";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { createStaffUser } from "@/lib/crm/staff";
import { sendEmail } from "@/lib/notifications/channels/email";
import { escapeHtml, summaryCardHtml, wrapEmailHtml } from "@/lib/notifications/templates/email-layout";
import { requireManageTeam, auditAgentWrite } from "@/agent/lib/guard";

const generatePassword = () => crypto.randomBytes(15).toString("base64url");

export default defineTool({
  description:
    "Create a new staff account (OWNER only). A random temporary password is generated and emailed to the business owner's inbox — it is never shown in this chat. Confirm the email, name, and role with the operator first.",
  inputSchema: z.object({
    email: z.string().email(),
    displayName: z.string().min(1),
    role: z.enum(["OPERATOR", "READONLY", "DEVELOPER"]),
  }),
  approval: always(),
  async execute({ email, displayName, role }, ctx) {
    requireManageTeam(ctx);
    const password = generatePassword();
    const created = await createStaffUser({ email, displayName, password, role });

    const ownerEmail = process.env.STAFF_OWNER_EMAIL?.trim();
    if (ownerEmail) {
      await sendEmail({
        to: ownerEmail,
        subject: "Nueva cuenta de staff creada",
        html: wrapEmailHtml({
          eyebrow: "CRM · Equipo",
          title: "Nueva cuenta de staff",
          bodyHtml: `<p>Se creó una cuenta nueva desde el asistente del CRM.</p>${summaryCardHtml([
            { label: "Nombre", value: displayName },
            { label: "Email", value: email },
            { label: "Rol", value: role },
            { label: "Contraseña temporal", value: password, highlight: true },
          ])}<p>Comparte la contraseña con ${escapeHtml(displayName)} por un canal seguro y pídele que la cambie al entrar.</p>`,
        }),
        text: `Nueva cuenta de staff creada.\nNombre: ${displayName}\nEmail: ${email}\nRol: ${role}\nContraseña temporal: ${password}\n\nComparte la contraseña por un canal seguro.`,
      });
    }

    await auditAgentWrite(ctx, {
      action: "STAFF_CREATED",
      entityType: "StaffUser",
      entityId: created.id,
      changes: { email, role },
    });

    return {
      staff: { id: created.id, email: created.email, displayName: created.displayName, role: created.role },
      passwordDelivered: Boolean(ownerEmail),
    };
  },
});
