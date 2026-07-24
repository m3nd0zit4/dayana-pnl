import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { createPromoCode } from "@/lib/crm/promo-codes-admin";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Create a new promo code. Confirm the exact code, discount, and any expiry/redemption limit with the operator before calling this — codes are customer-facing and hard to walk back once shared.",
  inputSchema: z.object({
    code: z.string().min(2).max(40),
    description: z.string().max(200).optional(),
    discountType: z.enum(["PERCENT", "FIXED_AMOUNT"]),
    percentOff: z.number().int().min(1).max(100).optional().describe("Required when discountType is PERCENT"),
    amountOffUsdMinor: z.number().int().min(1).optional().describe("USD cents off, when discountType is FIXED_AMOUNT"),
    amountOffCopMinor: z.number().int().min(1).optional().describe("COP pesos off, when discountType is FIXED_AMOUNT"),
    maxRedemptions: z.number().int().min(1).optional(),
    expiresAt: z.string().datetime().optional().describe("ISO 8601 datetime"),
  }),
  approval: always(),
  async execute(input, ctx) {
    requireWriteStaff(ctx);
    const promo = await createPromoCode({
      ...input,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    });
    await auditAgentWrite(ctx, {
      action: "CREATE",
      entityType: "PromoCode",
      entityId: promo.id,
      changes: { code: promo.code, discountType: promo.discountType },
    });
    return {
      promoCode: {
        id: promo.id,
        code: promo.code,
        discountType: promo.discountType,
        percentOff: promo.percentOff,
        amountOffUsdMinor: promo.amountOffUsdMinor,
        amountOffCopMinor: promo.amountOffCopMinor,
        isActive: promo.isActive,
      },
    };
  },
});
