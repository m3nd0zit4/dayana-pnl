import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { updateProduct } from "@/lib/crm/products-admin";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Change the price of one product/plan (use list_products to find its id first). Confirm the new amount and currency with the operator — the public site picks it up within its normal cache window, not instantly.",
  inputSchema: z.object({
    productId: z.string().min(1),
    amountUsd: z.number().positive().optional().describe("New USD price, in whole dollars (e.g. 49.99)"),
    listAmountUsd: z.number().positive().optional().describe("Strikethrough 'was' price in USD, optional"),
    amountCop: z.number().positive().optional().describe("New COP price, in full pesos (no cents)"),
    listAmountCop: z.number().positive().optional(),
  }),
  approval: always(),
  async execute({ productId, ...rest }, ctx) {
    requireWriteStaff(ctx);
    const product = await updateProduct(productId, rest);
    await auditAgentWrite(ctx, {
      action: "UPDATE",
      entityType: "Product",
      entityId: productId,
      changes: rest,
    });
    return {
      product: product
        ? {
            id: product.id,
            title: product.title,
            prices: product.prices.map((p) => ({
              currency: p.currency,
              amountMinor: p.amountMinor,
              listAmountMinor: p.listAmountMinor,
            })),
          }
        : null,
    };
  },
});
