/**
 * Prueba de punta a punta de las comunidades de WhatsApp en el CRM, contra la
 * base de DESARROLLO y en modo prueba (no sale nada): una comunidad con su
 * enlace, tres personas invitadas — una escribió hace poco (texto gratis),
 * otra hace días (plantilla) y otra sin número —, luego se pegan los números
 * del grupo para marcar quién entró y se anuncia solo a los miembros.
 *
 *   bun scripts/whatsapp-communities-e2e.ts
 */
process.env.NOTIFICATIONS_DRY_RUN = "true";

import { prisma } from "@/lib/db";
import { announce, getCommunity, invite, markJoinedByPhones, addMembers, createCommunity } from "@/lib/crm/whatsapp-communities";
import { processNextBatch } from "@/lib/crm/whatsapp-sends";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

const NAME = "E2E · Comunidad Mujeres que sanan";
const LINK = "https://chat.whatsapp.com/E2eTestInviteLink";

const PEOPLE = [
  { phone: "+573000008811", firstName: "Laura", lastInbound: new Date(Date.now() - 2 * 3600_000) },
  // Guardada con el 1 de celular mexicano; en el grupo aparece sin él.
  { phone: "+5215599998812", firstName: "Marta", lastInbound: new Date(Date.now() - 5 * 86400_000) },
  { phone: "+nophone-e2e-8813", firstName: "Sofía", lastInbound: null },
];

const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  return ok;
};

const runAll = async (sendId: string, staffId: string) => {
  let progress = await processNextBatch(sendId, staffId);
  while (progress.pending > 0) progress = await processNextBatch(sendId, staffId);
  return progress;
};

const main = async () => {
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  const staff = await prisma.staffUser.findFirstOrThrow({ select: { id: true } });

  await prisma.messageTemplate.upsert({
    where: { key_locale: { key: "comunidad_invitacion", locale: "es" } },
    create: {
      key: "comunidad_invitacion",
      title: "Comunidad: invitación",
      body: "Hola {{nombre}}, te bendigo 💛 Te invito a unirte a {{comunidad}}. Entra con este enlace: {{enlace}} ¡Te espero!",
      metaTemplateName: "comunidad_invitacion",
      metaTemplateLang: "es",
      metaApprovalStatus: "APPROVED",
      metaCategory: "MARKETING",
      metaBody: "Hola {{1}}, te bendigo 💛 Te invito a unirte a {{2}}. Entra con este enlace: {{3}} ¡Te espero!",
      metaVarNames: ["nombre", "comunidad", "enlace"],
    },
    update: { metaApprovalStatus: "APPROVED" },
  });

  await prisma.whatsAppCommunity.deleteMany({ where: { name: NAME } });
  const community = await createCommunity({ name: NAME, kind: "community", inviteLink: LINK }, staff.id);

  const contactIds: string[] = [];
  for (const p of PEOPLE) {
    const c = await prisma.contact.upsert({
      where: { phoneE164: p.phone },
      create: { phoneE164: p.phone, firstName: p.firstName, notifyWhatsapp: true },
      update: { notifyWhatsapp: true },
    });
    contactIds.push(c.id);
    const digits = p.phone.replace(/\D/g, "");
    if (digits) await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: digits } });
    if (p.lastInbound) {
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
  const [laura, marta, sofia] = contactIds;

  // 1) Agregar como invitadas e invitar a las que aún no se les mandó.
  const added = await addMembers(community.id, contactIds, "INVITED");
  const inv = await invite(community.id, null, staff.id);
  const progress = await runAll(inv.sendId, staff.id);
  const rows = await prisma.whatsAppSendRecipient.findMany({ where: { sendId: inv.sendId } });
  for (const r of rows) console.log(`  ${r.name} ${r.phone ?? "—"}: ${r.status} ${r.mode ?? ""} ${r.error ?? ""}`);
  const msgs = await prisma.conversationMessage.findMany({
    where: { id: { in: rows.map((r) => r.messageId).filter((m): m is string => Boolean(m)) } },
    select: { body: true },
  });
  for (const m of msgs) console.log(`  MSG ${m.body}`);
  const send = await prisma.whatsAppSend.findUniqueOrThrow({ where: { id: inv.sendId } });

  // 2) Pegar los números de la info del grupo (con ruido de formato).
  const pasted = "Participantes:\n‪+52 55 9999 8812‬ ~Marta\n+57 311 000 0000\nTú";
  const preview = await markJoinedByPhones(community.id, pasted, { apply: false });
  const applied = await markJoinedByPhones(community.id, pasted, { apply: true });
  const after = await getCommunity(community.id);
  const statusOf = (id: string) => after?.members.find((m) => m.contactId === id)?.status;
  console.log("  PASTE", JSON.stringify({ matched: applied.matched.map((m) => m.name), unknown: applied.unknown }));

  // 3) Anunciar: solo a quien está.
  const ann = await announce(community.id, "Hola {{nombre}}, te bendigo 💛 Novedad en " + NAME + ": el jueves hay meditación.", staff.id);
  const annSend = await prisma.whatsAppSend.findUniqueOrThrow({
    where: { id: ann.sendId },
    include: { recipients: true },
  });
  await runAll(ann.sendId, staff.id);

  const results = [
    check("3 personas agregadas", added === 3),
    check("envío de tipo comunidad con la plantilla de invitación", send.kind === "comunidad" && send.templateKey === "comunidad_invitacion"),
    check("1 texto (dentro de 24 h)", rows.filter((r) => r.mode === "text").length === 1),
    check("1 plantilla (fuera de 24 h)", rows.filter((r) => r.mode === "template").length === 1),
    check("1 sin enviar (sin número)", progress.skipped === 1 && rows.some((r) => r.contactId === sofia && r.status === "NO_PHONE")),
    check("el texto lleva el enlace", msgs.some((m) => m.body?.includes(LINK))),
    check("las 3 quedan invitadas con el envío", after!.members.filter((m) => m.inviteSendId === inv.sendId).length === 3),
    check("la vista previa no cambia nada", preview.updated === 0 && preview.matched.length === 1),
    check("Marta (52 sin el 1) quedó como miembro", statusOf(marta) === "JOINED" && applied.updated === 1),
    check("Laura sigue invitada", statusOf(laura) === "INVITED"),
    check("el número desconocido se reporta", applied.unknown.length === 1),
    check("el anuncio va exactamente a 1 persona", ann.total === 1 && annSend.recipients.length === 1 && annSend.recipients[0].contactId === marta),
  ];

  await prisma.whatsAppCommunity.delete({ where: { id: community.id } });
  const ok = results.every(Boolean);
  console.log(ok ? "\n✅ OK" : "\n❌ FALLÓ");
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
