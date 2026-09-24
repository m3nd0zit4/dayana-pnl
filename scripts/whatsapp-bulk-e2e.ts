/**
 * Prueba de punta a punta de los envíos por WhatsApp desde el CRM, contra la
 * base de DESARROLLO y en modo prueba (no sale nada): tres personas — una que
 * escribió hace poco (texto gratis), otra hace días (plantilla) y otra sin
 * número — reciben el enlace del evento gratuito.
 *
 *   NOTIFICATIONS_DRY_RUN=true bun scripts/whatsapp-bulk-e2e.ts
 */
import { prisma } from "@/lib/db";
import { createSend, previewSend, processNextBatch } from "@/lib/crm/whatsapp-sends";
import { whatsAppStatusFor } from "@/lib/crm/whatsapp-outbound";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

const PEOPLE = [
  { phone: "+573000007711", firstName: "Laura", lastInbound: new Date(Date.now() - 2 * 3600_000) },
  { phone: "+573000007712", firstName: "Marta", lastInbound: new Date(Date.now() - 5 * 86400_000) },
  { phone: "+nophone-e2e-7713", firstName: "Sofía", lastInbound: null },
];

const main = async () => {
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  const staff = await prisma.staffUser.findFirstOrThrow({ select: { id: true } });

  await prisma.messageTemplate.upsert({
    where: { key_locale: { key: "evento_gratis_invitacion", locale: "es" } },
    create: {
      key: "evento_gratis_invitacion",
      title: "Invitación a evento gratis",
      body: "Hola {{nombre}}, te invito a {{evento}} el {{fecha}}: {{enlace}}",
      metaTemplateName: "evento_gratis_invitacion",
      metaTemplateLang: "es",
      metaApprovalStatus: "APPROVED",
      metaCategory: "MARKETING",
      metaBody: "Hola {{1}}, te invito a {{2}} el {{3}}: {{4}}",
      metaVarNames: ["nombre", "evento", "fecha", "enlace"],
    },
    update: { metaApprovalStatus: "APPROVED" },
  });

  const contactIds: string[] = [];
  for (const p of PEOPLE) {
    const c = await prisma.contact.upsert({
      where: { phoneE164: p.phone },
      create: { phoneE164: p.phone, firstName: p.firstName, notifyWhatsapp: true },
      update: { notifyWhatsapp: true },
    });
    contactIds.push(c.id);
    if (p.lastInbound) {
      const digits = p.phone.replace(/\D/g, "");
      await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: digits } });
      await prisma.conversation.create({
        data: {
          channel: "WHATSAPP",
          externalThreadId: digits,
          contactId: c.id,
          metaAccountId: "test-phone-id",
          participantName: p.firstName,
          lastInboundAt: p.lastInbound,
          lastMessageAt: p.lastInbound,
        },
      });
    }
  }

  const text = "Hola {{nombre}} 💛 Te espero en el evento gratuito: https://example.com/eventos-gratuitos";
  const vars = { evento: "Sanar la relación", fecha: "jueves 7 p.m.", enlace: "https://example.com/eventos-gratuitos" };

  const preview = await previewSend({ contactIds, templateKey: "evento_gratis_invitacion" });
  console.log("PREVIEW", JSON.stringify(preview, null, 1));

  const created = await createSend({
    title: "E2E · enlace del evento",
    kind: "evento",
    text,
    templateKey: "evento_gratis_invitacion",
    vars,
    contactIds,
    staffId: staff.id,
  });
  let progress = await processNextBatch(created.id, staff.id);
  while (progress.pending > 0) progress = await processNextBatch(created.id, staff.id);
  console.log("PROGRESS", progress);

  const rows = await prisma.whatsAppSendRecipient.findMany({ where: { sendId: created.id } });
  for (const r of rows) console.log(`  ${r.name} ${r.phone}: ${r.status} ${r.mode ?? ""} ${r.error ?? ""}`);
  const msgs = await prisma.conversationMessage.findMany({
    where: { id: { in: rows.map((r) => r.messageId).filter((m): m is string => Boolean(m)) } },
    select: { body: true, source: true, status: true },
  });
  for (const m of msgs) console.log(`  MSG [${m.source}] ${m.status}: ${m.body}`);
  console.log("STATUS", await whatsAppStatusFor(contactIds));

  const ok =
    progress.sent === 2 &&
    progress.skipped === 1 &&
    rows.some((r) => r.mode === "text") &&
    rows.some((r) => r.mode === "template");
  console.log(ok ? "\n✅ OK" : "\n❌ FALLÓ");
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
