import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { upsertContactByPhone } from "@/lib/crm/contacts";
import { getPerson } from "@/lib/google/people";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";
import { accountLabel, resolveGoogleAccount } from "@/agent/lib/google";

export default defineTool({
  description:
    "Copy one Google contact into the CRM, by the resourceName that search_google_contacts returned. Like create_contact, it updates the existing CRM contact when the phone already matches rather than duplicating. Read the name and phone back to the operator before calling: a Google contact can carry an old or work number.",
  inputSchema: z.object({
    resourceName: z
      .string()
      .min(1)
      .describe("`people/c123…`, tal cual lo devolvió search_google_contacts."),
    phoneOverride: z
      .string()
      .optional()
      .describe("Usa este teléfono en lugar del primero de Google."),
    accountId: z.string().optional(),
  }),
  approval: always(),
  async execute({ resourceName, phoneOverride, accountId }, ctx) {
    requireWriteStaff(ctx);

    const { account, token } = await resolveGoogleAccount("CONTACTS", accountId);
    const person = await getPerson(token, resourceName);

    const phone = phoneOverride ?? person.phones[0];
    if (!phone) {
      throw new Error(
        `${person.name ?? "Ese contacto de Google"} no tiene teléfono guardado. El CRM identifica a cada contacto por su número, así que pásalo con phoneOverride o créalo con create_contact.`
      );
    }

    // Google guarda un solo campo de nombre. Partirlo por el primer espacio es
    // una convención, no un dato: por eso el resultado devuelve lo que quedó,
    // para que el operador lo corrija si hace falta.
    const [firstName, ...rest] = (person.name ?? "").trim().split(/\s+/);

    const { contact, created } = await upsertContactByPhone({
      phone,
      firstName: firstName || "Sin nombre",
      lastName: rest.join(" ") || undefined,
      email: person.emails[0],
      source: "OTHER",
      sourceDetail: `google:${accountLabel(account)}`,
    });

    await auditAgentWrite(ctx, {
      action: created ? "CREATE" : "UPDATE",
      entityType: "Contact",
      entityId: contact.id,
      changes: {
        importedFrom: accountLabel(account),
        resourceName,
        phone: contact.phoneE164,
      },
    });

    return {
      contactId: contact.id,
      created,
      name: contact.displayName ?? `${contact.firstName} ${contact.lastName ?? ""}`.trim(),
      phone: contact.phoneE164,
      email: contact.email,
      ref: { type: "contact" as const, id: contact.id, href: `/admin/contacts/${contact.id}` },
    };
  },
});
