import { defineTool } from "eve/tools";
import { z } from "zod";
import { getActiveProducts } from "@/lib/crm/products";

export default defineTool({
  description: "List active products (therapies, courses, workshops) with their kind and session count.",
  inputSchema: z.object({}),
  async execute() {
    const products = await getActiveProducts();
    return {
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        kind: p.kind,
        sessionsCount: p.sessionsCount,
        prices: p.prices.map((pr) => ({ currency: pr.currency, amountMinor: pr.amountMinor })),
      })),
    };
  },
});
