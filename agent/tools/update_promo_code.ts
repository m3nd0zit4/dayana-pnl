import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { updatePromoCode } from "@/lib/crm/promo-codes-admin";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Edit an existing promo code (discount, active flag, expiry, redemption limit). Use list_products/dashboard context or ask the operator for the promo code's id first.",
  inputSchema: z.object({
    promoCodeId: z.string().min(1),
    code: z.string().min(2).max(40).optional(),
    description: z.string().max(200).optional(),
    discountType: z.enum(["PERCENT", "FIXED_AMOUNT"]).optional(),
    percentOff: z.number().int().min(1).max(100).optional(),
    amountOffUsdMinor: z.number().int().min(1).optional(),
    amountOffCopMinor: z.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
    maxRedemptions: z.number().int().min(1).optional(),
    expiresAt: z.string().datetime().optional().describe("ISO 8601 datetime"),
  }),
  approval: always(),
  async execute({ promoCodeId, expiresAt, ...rest }, ctx) {
    requireWriteStaff(ctx);
    const promo = await updatePromoCode(promoCodeId, {
      ...rest,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });
    await auditAgentWrite(ctx, {
      action: "UPDATE",
      entityType: "PromoCode",
      entityId: promo.id,
      changes: rest,
    });
    return {
      promoCode: {
        id: promo.id,
        code: promo.code,
        isActive: promo.isActive,
        discountType: promo.discountType,
      },
    };
  },
});
