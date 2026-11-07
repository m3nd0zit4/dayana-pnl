import { ProductKind } from "@prisma/client";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { createProduct } from "@/lib/crm/products-admin";
import { requireManageTeam, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Create a payable product (kind: workshop) so a workshop edition can charge for online payment — the same thing an operator would create on /admin/products first. Both USD and COP prices are required: without a COP price, Colombian visitors would see a pay button that fails at checkout. OWNER-only, separate from create_workshop/update_workshop. Use the returned product id as productId when calling create_workshop or update_workshop.",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    amountUsd: z.number().positive().describe("Price in whole USD, e.g. 49.99"),
    amountCop: z.number().positive().describe("Price in whole COP pesos (no centavos) — required, ask the operator if not given"),
    sessionsLabel: z.string().max(120).optional().describe("Short label, e.g. 'Taller en vivo' — defaults to that if omitted"),
  }),
  approval: always(),
  async execute({ title, amountUsd, amountCop, sessionsLabel }, ctx) {
    requireManageTeam(ctx);
    const product = await createProduct({
      kind: ProductKind.WORKSHOP,
      title,
      sessionsLabel: sessionsLabel ?? "Taller en vivo",
      amountUsd,
      amountCop,
    });
    await auditAgentWrite(ctx, {
      action: "CREATE",
      entityType: "Product",
      entityId: product.id,
      changes: { title, amountUsd, amountCop },
    });
    return {
      product: {
        id: product.id,
        title: product.title,
        kind: product.kind,
        prices: product.prices.map((p) => ({ currency: p.currency, amountMinor: p.amountMinor })),
      },
    };
  },
});
