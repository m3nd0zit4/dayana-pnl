import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  STARTER_TEMPLATES,
  createWhatsAppTemplate,
  getTemplatePrices,
  listWhatsAppTemplates,
  setTemplatePrices,
  syncWhatsAppTemplates,
} from "@/lib/crm/whatsapp-templates";
import { Dialog360Error } from "@/lib/meta/whatsapp-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withStaff("read", async () =>
  NextResponse.json({
    items: await listWhatsAppTemplates(),
    starters: STARTER_TEMPLATES,
    prices: await getTemplatePrices(),
  })
);

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }),
  z.object({
    action: z.literal("create"),
    key: z.string().trim().min(2).max(60),
    title: z.string().trim().min(2).max(120),
    category: z.enum(["UTILITY", "MARKETING"]),
    body: z.string().trim().min(5).max(1024),
    example: z.record(z.string(), z.string().max(300)).default({}),
  }),
  z.object({
    action: z.literal("prices"),
    currency: z.string().trim().min(3).max(3),
    MARKETING: z.number().min(0).max(5),
    UTILITY: z.number().min(0).max(5),
  }),
]);

export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const input = parsed.data;
  try {
    if (input.action === "sync") {
      const count = await syncWhatsAppTemplates();
      return NextResponse.json({ ok: true, count, items: await listWhatsAppTemplates() });
    }
    if (input.action === "prices") {
      await setTemplatePrices({ currency: input.currency.toUpperCase(), MARKETING: input.MARKETING, UTILITY: input.UTILITY });
      return NextResponse.json({ ok: true, prices: await getTemplatePrices() });
    }
    const created = await createWhatsAppTemplate(input);
    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "WhatsAppTemplate",
      entityId: created.name,
      changes: { category: input.category },
    });
    return NextResponse.json({ ok: true, ...created, items: await listWhatsAppTemplates() });
  } catch (e) {
    if (e instanceof Dialog360Error) {
      return NextResponse.json({ error: "dialog360_error", message: e.message }, { status: 502 });
    }
    throw e;
  }
});
