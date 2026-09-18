import type { ContactTouchKind } from "@prisma/client";

import { prisma } from "@/lib/db";

import { combineWhatsAppMarks, type WhatsAppMarks } from "./whatsapp-marks";

/**
 * Registro y lectura de los clics hacia WhatsApp (`ContactTouch`).
 *
 * Registrar **nunca lanza**: es contabilidad del CRM y va en el camino de
 * alguien que está a punto de escribir a Dayana, o de Dayana abriendo un chat.
 */

/** Dos clics iguales en este margen son el mismo gesto (doble clic, recarga). */
const DEDUPE_MS = 2 * 60 * 1000;

export type RecordContactTouchInput = {
  contactId?: string | null;
  diagnosticId?: string | null;
  staffUserId?: string | null;
  kind: ContactTouchKind;
  source: string;
};

export async function recordContactTouch(input: RecordContactTouchInput): Promise<void> {
  const contactId = input.contactId ?? null;
  let diagnosticId = input.diagnosticId ?? null;
  if (!contactId && !diagnosticId) return;
  const source = input.source.trim().slice(0, 80) || "desconocido";
  const staffUserId = input.staffUserId ?? null;

  try {
    // Un diagnostico que no es de esta persona (o que no existe) no se enlaza:
    // se registra el clic sobre el contacto y se descarta el id ajeno. Sin
    // esto, un id inexistente hacia fallar el insert y el clic se perdia.
    if (diagnosticId && contactId) {
      const owned = await prisma.diagnostic.findFirst({
        where: { id: diagnosticId, contactId },
        select: { id: true },
      });
      if (!owned) diagnosticId = null;
    }

    const recent = await prisma.contactTouch.findFirst({
      where: {
        contactId,
        diagnosticId,
        staffUserId,
        kind: input.kind,
        source,
        createdAt: { gte: new Date(Date.now() - DEDUPE_MS) },
      },
      select: { id: true },
    });
    if (recent) return;

    await prisma.contactTouch.create({
      data: {
        contactId,
        diagnosticId,
        staffUserId,
        kind: input.kind,
        source,
      },
    });
  } catch (e) {
    console.error("[whatsapp-touches] no se pudo registrar el clic", e);
  }
}

/** El CTA «Hablar con Dayana» del resultado, por el token del diagnóstico. */
export async function recordDiagnosticResultWhatsApp(token: string): Promise<void> {
  const diagnostic = await prisma.diagnostic
    .findUnique({ where: { token }, select: { id: true, contactId: true } })
    .catch(() => null);
  if (!diagnostic) return;
  await recordContactTouch({
    contactId: diagnostic.contactId,
    diagnosticId: diagnostic.id,
    kind: "LEAD_WHATSAPP",
    source: "diagnostic_result",
  });
}

type DiagnosticForMarks = {
  id: string;
  contactId: string | null;
  createdAt: Date;
  checkoutStartedAt: Date | null;
};

/**
 * Las dos marcas de cada diagnóstico de una página, en dos consultas
 * agregadas —no una por fila—: la lista de Diagnósticos carga 200.
 */
export async function whatsAppMarksForDiagnostics(
  rows: DiagnosticForMarks[],
): Promise<Map<string, WhatsAppMarks>> {
  const contactIds = [
    ...new Set(rows.map((r) => r.contactId).filter((id): id is string => Boolean(id))),
  ];
  const diagnosticIds = rows.map((r) => r.id);

  const [byContact, byDiagnostic] = await Promise.all([
    contactIds.length > 0
      ? prisma.contactTouch.groupBy({
          by: ["contactId", "kind"],
          where: { contactId: { in: contactIds } },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    diagnosticIds.length > 0
      ? prisma.contactTouch.groupBy({
          by: ["diagnosticId"],
          where: { diagnosticId: { in: diagnosticIds }, kind: "LEAD_WHATSAPP" },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  const contactLead = new Map<string, Date>();
  const contactStaff = new Map<string, Date>();
  for (const g of byContact) {
    if (!g.contactId || !g._max.createdAt) continue;
    (g.kind === "STAFF_WHATSAPP" ? contactStaff : contactLead).set(
      g.contactId,
      g._max.createdAt,
    );
  }
  const diagnosticLead = new Map<string, Date>();
  for (const g of byDiagnostic) {
    if (g.diagnosticId && g._max.createdAt) diagnosticLead.set(g.diagnosticId, g._max.createdAt);
  }

  return new Map(
    rows.map((r) => [
      r.id,
      combineWhatsAppMarks({
        diagnosticCreatedAt: r.createdAt,
        checkoutStartedAt: r.checkoutStartedAt,
        diagnosticLeadAt: diagnosticLead.get(r.id) ?? null,
        contactLeadAt: r.contactId ? (contactLead.get(r.contactId) ?? null) : null,
        contactStaffAt: r.contactId ? (contactStaff.get(r.contactId) ?? null) : null,
      }),
    ]),
  );
}

/** Últimos clics de la persona y del equipo, para la ficha del contacto. */
export async function whatsAppMarksForContact(contactId: string): Promise<WhatsAppMarks> {
  const groups = await prisma.contactTouch.groupBy({
    by: ["kind"],
    where: { contactId },
    _max: { createdAt: true },
  });
  const pick = (kind: ContactTouchKind) =>
    groups.find((g) => g.kind === kind)?._max.createdAt ?? null;
  return { leadAt: pick("LEAD_WHATSAPP"), staffAt: pick("STAFF_WHATSAPP") };
}
