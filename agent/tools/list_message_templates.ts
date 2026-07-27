import { defineTool } from "eve/tools";
import { z } from "zod";
import { listAgentTemplates } from "@/lib/crm/messages";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "List the message templates you can use with a contact. Each one reports `canWhatsApp` (usable with prepare_customer_whatsapp_message), `canEmail` (usable with send_contact_template_email), and `requiredVars` — the variables the template needs. Anything beyond first_name/last_name/display_name/phone/site_url you must look up and pass in `vars`, or the send is refused rather than delivering a broken placeholder. Transactional templates (invitations, password resets, receipts, membership notices) are not listed for email because the system sends those itself.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const templates = await listAgentTemplates();
    return { templates };
  },
});
