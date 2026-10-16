/**
 * Deja en el CRM a las clientas de WhatsApp que aún no tienen contacto (pedido
 * de la dueña, 15-oct-2026). Desde este cambio el contacto se crea solo al
 * confirmar un comprobante, al marcarla clienta o cuando su estado dice que
 * es clienta confirmada; esto arregla las de antes.
 *
 *   bun scripts/whatsapp-client-contacts.ts                              (prueba: dice qué haría y no toca nada)
 *   bun scripts/whatsapp-client-contacts.ts --apply --i-have-a-backup    (lo aplica)
 *
 * Entran los chats de WhatsApp sin contacto cuya ficha dice clienta confirmada
 * (segmento `client` y no «por revisar»: clienta_activa / clienta_pasada) o que
 * Dayana marcó clienta a mano. La prueba lee lo guardado; al aplicar, cada
 * chat se vuelve a calcular primero y se salta si ya no es clienta o quedó por
 * revisar.
 *
 * Por chat: el número enmascarado (solo los últimos 4 dígitos), el nombre de
 * WhatsApp, el estado y qué pasa: se vincula al contacto que ya existe con
 * cualquier forma del número (+52 / +521…), se crea uno nuevo, o no tiene
 * número (usuario de WhatsApp sin número: se vincula a mano).
 *
 * Usa el DATABASE_URL del entorno: mira la base que imprime antes de aplicar.
 * En producción, solo con respaldo de Neon y el OK de la dueña.
 */
import { prisma } from "@/lib/db";
import { computeSegment } from "@/lib/crm/whatsapp-agent/segment-store";
import { ClientContactError, ensureConversationContact } from "@/lib/crm/whatsapp-client-contact";
import { phoneFromWhatsAppId } from "@/lib/phone";
import { contactPhoneCandidates, isWhatsAppUserId } from "@/lib/whatsapp-contact";

const apply = process.argv.includes("--apply");
const backedUp = process.argv.includes("--i-have-a-backup");

const dbName = () => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "") || "?";
  } catch {
    return "?";
  }
};

/** Solo los últimos 4 dígitos: la salida se puede pegar en un chat sin dejar números. */
const masked = (threadIdOrPhone: string) =>
  isWhatsAppUserId(threadIdOrPhone)
    ? `${threadIdOrPhone.slice(0, 2)}.…${threadIdOrPhone.slice(-4)}`
    : `…${threadIdOrPhone.replace(/\D/g, "").slice(-4)}`;

type Plan =
  | { action: "link"; contactId: string; contactName: string; contactPhone: string }
  | { action: "create"; phoneE164: string; countryIso: string }
  | { action: "no_phone" };

const describe = (plan: Plan) =>
  plan.action === "link"
    ? `vincular a ${plan.contactName} (${masked(plan.contactPhone)})`
    : plan.action === "create"
      ? `crear contacto ${masked(plan.phoneE164)} (${plan.countryIso})`
      : "sin número: se vincula a mano";

const main = async () => {
  console.info(`Base: ${dbName()} · ${apply ? "APLICAR" : "prueba (no cambia nada)"}`);
  if (apply && !backedUp) {
    console.error("Para aplicar hace falta --i-have-a-backup (respaldo de Neon hecho antes).");
    process.exit(1);
  }

  const rows = await prisma.conversation.findMany({
    where: {
      channel: "WHATSAPP",
      contactId: null,
      OR: [{ dossier: { segment: "client", segmentReview: false } }, { category: "cliente", categorySource: "manual" }],
    },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      externalThreadId: true,
      participantName: true,
      category: true,
      categorySource: true,
      dossier: { select: { segment: true, segmentReview: true, stage: true } },
    },
  });

  // El mismo orden que `ensureConversationContact`: primero un contacto que ya
  // exista con cualquier forma del número (el más antiguo), si no uno nuevo.
  const candidatesOf = new Map(rows.map((r) => [r.id, contactPhoneCandidates(r.externalThreadId)]));
  const existing = await prisma.contact.findMany({
    where: { phoneE164: { in: [...new Set([...candidatesOf.values()].flat())] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, firstName: true, lastName: true, phoneE164: true },
  });
  const planOf = (r: (typeof rows)[number]): Plan => {
    const candidates = candidatesOf.get(r.id) ?? [];
    const contact = existing.find((c) => candidates.includes(c.phoneE164));
    if (contact) {
      return {
        action: "link",
        contactId: contact.id,
        contactName: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "(sin nombre)",
        contactPhone: contact.phoneE164,
      };
    }
    const phone = phoneFromWhatsAppId(r.externalThreadId);
    return phone ? { action: "create", phoneE164: phone.phoneE164, countryIso: phone.phoneCountryIso } : { action: "no_phone" };
  };

  const fromDossier = (r: (typeof rows)[number]) => r.dossier?.segment === "client" && !r.dossier.segmentReview;
  const fromManual = (r: (typeof rows)[number]) => r.category === "cliente" && r.categorySource === "manual";
  const plans = rows.map((r) => ({ row: r, plan: planOf(r) }));

  console.info(`\nChats de WhatsApp de clientas sin contacto: ${rows.length}.`);
  for (const { row, plan } of plans) {
    const why = [fromDossier(row) ? "ficha" : null, fromManual(row) ? "a mano" : null].filter(Boolean).join(" + ");
    console.info(
      `- ${masked(row.externalThreadId)} · ${row.participantName ?? "(sin nombre)"} · ${row.dossier?.stage ?? "sin estado"} · clienta por ${why} → ${describe(plan)}`
    );
  }
  const count = (action: Plan["action"]) => plans.filter((p) => p.plan.action === action).length;
  console.info(
    `\nTotal: ${rows.length} (ficha: ${rows.filter(fromDossier).length} · a mano: ${rows.filter(fromManual).length}). ` +
      `Vincular a uno existente: ${count("link")} · crear: ${count("create")} · sin número: ${count("no_phone")}.`
  );

  if (!apply || plans.length === 0) return;
  console.info("\nAplicando…");
  const done = { linked: 0, created: 0, noPhone: 0, skipped: 0, failed: 0 };
  for (const { row, plan } of plans) {
    const label = `${masked(row.externalThreadId)} · ${row.participantName ?? "(sin nombre)"}`;
    try {
      // Se vuelve a calcular: si ya no es clienta confirmada, no se toca. (Si lo
      // es, el cálculo ya crea el contacto; lo de abajo lo confirma.)
      const segment = await computeSegment(row.id);
      if (!segment || segment.segment !== "client" || segment.review) {
        done.skipped++;
        console.info(`  se salta ${label}: ahora es ${segment?.segment ?? "?"}${segment?.review ? ", por revisar" : ""}`);
        continue;
      }
      await ensureConversationContact({ conversationId: row.id, staffUserId: null, sourceDetail: "Clienta de WhatsApp" });
      if (plan.action === "create") {
        done.created++;
        console.info(`  creado ${label}`);
      } else {
        done.linked++;
        console.info(`  vinculado ${label}${plan.action === "link" ? ` → ${plan.contactName}` : ""}`);
      }
    } catch (e) {
      if (e instanceof ClientContactError && e.message === "no_phone") {
        done.noPhone++;
        console.info(`  sin número ${label}: vincúlalo a mano`);
        continue;
      }
      done.failed++;
      console.error(`  falló ${label}:`, e instanceof Error ? e.message : e);
    }
  }
  console.info(
    `Listo. Vinculados: ${done.linked} · creados: ${done.created} · sin número: ${done.noPhone} · ` +
      `ya no eran clientas: ${done.skipped} · fallaron: ${done.failed}.`
  );
  if (done.failed) process.exitCode = 1;
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
