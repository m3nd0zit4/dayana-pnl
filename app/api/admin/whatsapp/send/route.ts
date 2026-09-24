import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import {
  planForRecipient,
  recipientFromContact,
  sendWhatsAppToContact,
} from "@/lib/crm/whatsapp-outbound";
import { approvedTemplateFor, getTemplatePrices, priceFor } from "@/lib/crm/whatsapp-templates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Qué pasaría al escribirle a este contacto (gratis, con plantilla o no se puede). */
export const GET = withStaff("read", async ({ req }) => {
  const url = new URL(req.url);
  const contactId = url.searchParams.get("contactId");
  if (!contactId) return apiError("invalid_body", 400);
  const recipient = await recipientFromContact(contactId);
  if (!recipient) return apiError("not_found", 404);
  const templateKey = url.searchParams.get("templateKey");
  const [template, prices] = await Promise.all([approvedTemplateFor(templateKey), getTemplatePrices()]);
  const plan = await planForRecipient(recipient, template);
  return NextResponse.json({
    plan,
    recipient: { name: recipient.name, phone: recipient.phoneE164, optedOut: recipient.optedOut },
    template: template ? { key: template.key, title: template.title, body: template.body } : null,
    price: plan.action === "template" ? priceFor(prices, template?.metaCategory) : 0,
    currency: prices.currency,
  });
});

const bodySchema = z.object({
  contactId: z.string(),
  text: z.string().trim().max(4000).default(""),
  templateKey: z.string().max(120).nullish(),
  vars: z.record(z.string(), z.string().max(1000)).optional(),
  source: z.string().max(60).default("perfil"),
  attachment: z
    .object({ url: z.string().url().max(600), mimeType: z.string().max(80), filename: z.string().max(200) })
    .nullish(),
});

/** Enviar un WhatsApp a un contacto desde cualquier pantalla del CRM. */
export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const input = parsed.data;
  if (!input.text && !input.templateKey && !input.attachment) return apiError("empty_message", 400);
  const result = await sendWhatsAppToContact({
    contactId: input.contactId,
    text: input.text,
    templateKey: input.templateKey ?? null,
    vars: input.vars,
    attachment: input.attachment ?? null,
    source: `crm:${input.source}`,
    staffId: staff.id,
  });
  return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
});
