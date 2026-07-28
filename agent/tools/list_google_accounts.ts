import { defineTool } from "eve/tools";
import { z } from "zod";
import { listGoogleAccounts } from "@/lib/crm/google-accounts";
import { SERVICE_LABELS } from "@/lib/google/connect";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "List the Google accounts connected to the CRM and which services (Calendar, Contacts, Drive) each one exposes. Call this first when a Google tool tells you there are several candidate accounts, or when the operator asks what is connected. The `accountId` values it returns are what the other Google tools accept.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);

    const accounts = await listGoogleAccounts();
    return {
      accounts: accounts.map((a) => ({
        accountId: a.id,
        email: a.email,
        name: a.displayName,
        services: a.services.map((s) => SERVICE_LABELS[s]),
        rawServices: a.services,
        isActive: a.isActive,
        // Una cuenta inactiva no se arregla reintentando: hay que volver a
        // autorizarla desde ajustes, y eso lo hace una persona.
        note: a.isActive
          ? undefined
          : "Sin autorizar — el operador debe reconectarla en /admin/ajustes/google.",
      })),
    };
  },
});
