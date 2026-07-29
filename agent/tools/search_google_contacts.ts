import { defineTool } from "eve/tools";
import { z } from "zod";
import { searchContacts, warmSearchCache } from "@/lib/google/people";
import { requireStaff } from "@/agent/lib/guard";
import { accountLabel, resolveGoogleAccount } from "@/agent/lib/google";

export default defineTool({
  description:
    "Search the Google contacts of a connected account by name, email or phone. Read-only, and separate from the CRM's own contacts — use search_contacts for those. Useful when the operator says 'I have their number in my phone' and you need to find it before creating a CRM contact.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(100),
    limit: z.number().int().min(1).max(50).optional(),
    accountId: z.string().optional(),
  }),
  async execute({ query, limit, accountId }, ctx) {
    requireStaff(ctx);

    const { account, token } = await resolveGoogleAccount("CONTACTS", accountId);

    // El índice de búsqueda de People se construye por sesión: sin calentarlo,
    // la primera consulta con un término nuevo puede volver vacía aunque el
    // contacto exista, y eso se leería como "no está".
    await warmSearchCache(token);
    const people = await searchContacts(token, query, limit);

    return {
      account: accountLabel(account),
      count: people.length,
      contacts: people.map((p) => ({
        resourceName: p.resourceName,
        name: p.name,
        emails: p.emails,
        phones: p.phones,
        organization: p.organization,
      })),
      note:
        people.length === 0
          ? "Sin resultados. La búsqueda de Google solo mira los contactos guardados en esa cuenta."
          : undefined,
    };
  },
});
