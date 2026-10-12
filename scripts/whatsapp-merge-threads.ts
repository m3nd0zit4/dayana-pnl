/**
 * Une los chats duplicados de una misma persona (el mismo número en dos
 * formas: México 52/521, Argentina 54/549, Brasil con y sin 9). Desde que
 * `lib/meta/whatsapp-thread.ts` busca el chat existente ya no se crean nuevos;
 * esto arregla los que quedaron de antes o de una importación.
 *
 *   bun scripts/whatsapp-merge-threads.ts                              (prueba: dice qué uniría y no toca nada)
 *   bun scripts/whatsapp-merge-threads.ts --apply --i-have-a-backup    (lo aplica)
 *
 * Se pasan al chat que queda: mensajes, ejecuciones de la IA, ejemplos,
 * reservas, citas, autoevaluaciones y destinatarios de envíos; la memoria se
 * junta. El chat que queda conserva lo más fuerte de los dos (contacto, nombre,
 * favorito, pausa, escalada, categoría puesta a mano). Cada unión deja una
 * fila en el registro de auditoría.
 *
 * También lista los chats que solo tienen ecos (Dayana escribió desde el
 * celular y la persona nunca respondió ahí): suelen ser personas con nombre
 * de usuario cuyo número no se conoce; se revisan a mano.
 *
 * Usa el DATABASE_URL del entorno: mira la base que imprime antes de aplicar.
 * En producción, solo con respaldo de Neon y el OK de la dueña.
 */
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/crm/audit";
import { planThreadMerges, type MergePlan } from "@/lib/crm/whatsapp-thread-merge";

const apply = process.argv.includes("--apply");
const backedUp = process.argv.includes("--i-have-a-backup");

const dbName = () => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "") || "?";
  } catch {
    return "?";
  }
};

const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
const earlier = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);

const mergeOne = async (plan: MergePlan) => {
  for (const dup of plan.merge) {
    await prisma.$transaction(async (tx) => {
      const [keep, gone] = await Promise.all([
        tx.conversation.findUniqueOrThrow({ where: { id: plan.survivorId } }),
        tx.conversation.findUniqueOrThrow({ where: { id: dup.id } }),
      ]);
      const to = { conversationId: keep.id };
      const moved = {
        messages: (await tx.conversationMessage.updateMany({ where: { conversationId: gone.id }, data: to })).count,
        runs: (await tx.whatsAppAiRun.updateMany({ where: { conversationId: gone.id }, data: to })).count,
        examples: (await tx.whatsAppReplyExample.updateMany({ where: { conversationId: gone.id }, data: to })).count,
        bookings: (await tx.whatsAppBooking.updateMany({ where: { conversationId: gone.id }, data: to })).count,
        appointments: (await tx.calendarAppointment.updateMany({ where: { conversationId: gone.id }, data: to })).count,
        diagnostics: (
          await tx.diagnostic.updateMany({ where: { outreachConversationId: gone.id }, data: { outreachConversationId: keep.id } })
        ).count,
        sendRecipients: (await tx.whatsAppSendRecipient.updateMany({ where: { conversationId: gone.id }, data: to })).count,
      };

      // La memoria va por número: se junta en la del chat que queda.
      const [memKeep, memGone] = await Promise.all([
        tx.whatsAppMemory.findUnique({ where: { phone: keep.externalThreadId } }),
        tx.whatsAppMemory.findUnique({ where: { phone: gone.externalThreadId } }),
      ]);
      if (memGone) {
        const notes = [memKeep?.notes, memGone.notes].filter(Boolean).join("\n").slice(0, 1500);
        await tx.whatsAppMemory.upsert({
          where: { phone: keep.externalThreadId },
          create: { phone: keep.externalThreadId, contactId: memGone.contactId ?? keep.contactId, notes },
          update: { notes, contactId: memKeep?.contactId ?? memGone.contactId },
        });
        await tx.whatsAppMemory.delete({ where: { phone: gone.externalThreadId } });
      }

      await tx.conversation.delete({ where: { id: gone.id } });
      // La ficha del que queda se vuelve a leer con todos los mensajes.
      await tx.whatsAppDossier.updateMany({
        where: { conversationId: keep.id },
        data: { coveredThroughAt: null, coveredCount: 0, summary: "", facts: {} },
      });
      await tx.conversation.update({
        where: { id: keep.id },
        data: {
          contactId: keep.contactId ?? gone.contactId,
          participantName: keep.participantName ?? gone.participantName,
          participantAvatarUrl: keep.participantAvatarUrl ?? gone.participantAvatarUrl,
          lastMessageAt: later(keep.lastMessageAt, gone.lastMessageAt) ?? keep.lastMessageAt,
          lastInboundAt: later(keep.lastInboundAt, gone.lastInboundAt),
          lastHumanReplyAt: later(keep.lastHumanReplyAt, gone.lastHumanReplyAt),
          unreadCount: keep.unreadCount + gone.unreadCount,
          priorityAt: keep.priorityAt ?? gone.priorityAt,
          // Una pausa o escalada en cualquiera de los dos sigue en pie.
          ...(keep.aiPausedAt || !gone.aiPausedAt
            ? {}
            : { aiPausedAt: gone.aiPausedAt, aiPausedReason: gone.aiPausedReason }),
          ...(keep.escalationCategory || !gone.escalationCategory
            ? {}
            : {
                escalationCategory: gone.escalationCategory,
                escalationReason: gone.escalationReason,
                escalationSeverity: gone.escalationSeverity,
              }),
          attentionAt: earlier(keep.attentionAt, gone.attentionAt),
          attentionReason: keep.attentionReason ?? gone.attentionReason,
          // La categoría puesta a mano gana a la de las reglas o la IA.
          ...(keep.categorySource !== "manual" && gone.categorySource === "manual"
            ? {
                category: gone.category,
                categorySource: gone.categorySource,
                categoryConfidence: gone.categoryConfidence,
                categoryReason: gone.categoryReason,
                categorizedAt: gone.categorizedAt,
              }
            : {}),
          // Lo reunido se vuelve a clasificar con todos los mensajes.
          categorizedThroughAt: null,
        },
      });
      await writeAuditLog({
        action: "MERGE",
        entityType: "Conversation",
        entityId: keep.id,
        changes: { merged: gone.id, from: gone.externalThreadId, into: keep.externalThreadId, moved },
      });
      console.info(`  unido ${gone.externalThreadId} → ${keep.externalThreadId}`, moved);
    });
  }
};

const main = async () => {
  console.info(`Base: ${dbName()} · ${apply ? "APLICAR" : "prueba (no cambia nada)"}`);
  if (apply && !backedUp) {
    console.error("Para aplicar hace falta --i-have-a-backup (respaldo de Neon hecho antes).");
    process.exit(1);
  }

  const rows = await prisma.$queryRaw<
    { id: string; external_thread_id: string; messages: bigint; last_message_at: Date | null; inbound: bigint; echoes: bigint }[]
  >`
    SELECT c.id, c.external_thread_id, c.last_message_at,
      COUNT(m.id) AS messages,
      COUNT(m.id) FILTER (WHERE m.direction = 'INBOUND') AS inbound,
      COUNT(m.id) FILTER (WHERE m.is_echo) AS echoes
    FROM conversations c LEFT JOIN conversation_messages m ON m.conversation_id = c.id
    WHERE c.channel = 'WHATSAPP'
    GROUP BY c.id`;

  const plans = planThreadMerges(
    rows.map((r) => ({
      id: r.id,
      externalThreadId: r.external_thread_id,
      messages: Number(r.messages),
      lastMessageAt: r.last_message_at,
    }))
  );
  console.info(`\nChats de WhatsApp: ${rows.length}. Personas con chats duplicados: ${plans.length}.`);
  for (const p of plans) {
    console.info(`- queda ${p.survivorThreadId} (${p.survivorId}); se le pasan: ${p.merge.map((m) => `${m.externalThreadId} (${m.messages} mensajes)`).join(", ")}`);
  }

  const echoOnly = rows.filter((r) => Number(r.inbound) === 0 && Number(r.echoes) > 0 && Number(r.echoes) === Number(r.messages));
  if (echoOnly.length) {
    console.info(`\nChats solo con ecos (revisar a mano; pueden ser de alguien con nombre de usuario): ${echoOnly.length}`);
    for (const r of echoOnly) console.info(`- ${r.external_thread_id} (${r.id}): ${Number(r.echoes)} ecos`);
  }

  if (!apply || plans.length === 0) return;
  console.info("\nUniendo…");
  for (const p of plans) await mergeOne(p);
  console.info("Listo.");
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
