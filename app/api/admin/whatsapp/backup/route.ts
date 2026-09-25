import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const attachmentNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((a) => (a && typeof a === "object" && "filename" in a ? String((a as { filename?: unknown }).filename ?? "adjunto") : "adjunto"))
    : [];

/**
 * Respaldo de todos los chats de WhatsApp del CRM, para descargar.
 * `?format=txt` (legible) o `?format=json` (completo, para restaurar o analizar).
 * Los archivos adjuntos no van (solo su nombre).
 */
export const GET = withStaff("owner", async ({ req, staff }) => {
  const format = new URL(req.url).searchParams.get("format") === "txt" ? "txt" : "json";
  const chats = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP" },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      externalThreadId: true,
      participantName: true,
      contact: { select: { firstName: true, lastName: true, email: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        select: {
          sentAt: true,
          direction: true,
          body: true,
          kind: true,
          status: true,
          isAutoReply: true,
          attachments: true,
        },
      },
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  fireAuditLog({
    action: "whatsapp.backup.download",
    entityType: "Conversation",
    entityId: "all",
    staffUserId: staff.id,
    changes: { format, chats: chats.length },
  });

  if (format === "json") {
    const data = chats.map((c) => ({
      phone: `+${c.externalThreadId}`,
      name: c.participantName,
      contact: c.contact,
      messages: c.messages.map((m) => ({
        at: m.sentAt.toISOString(),
        from: m.direction === "INBOUND" ? "persona" : m.isAutoReply ? "ia" : "dayana",
        text: m.body,
        kind: m.kind,
        status: m.status,
        attachments: attachmentNames(m.attachments),
      })),
    }));
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), chats: data }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="respaldo-chats-whatsapp-${stamp}.json"`,
      },
    });
  }

  const when = (d: Date) =>
    new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  const lines: string[] = [`Respaldo de chats de WhatsApp — ${when(new Date())} (hora de Colombia)`, ""];
  for (const c of chats) {
    lines.push("=".repeat(60), `${c.participantName ?? "Sin nombre"} · +${c.externalThreadId}`, "=".repeat(60));
    for (const m of c.messages) {
      const who = m.direction === "INBOUND" ? c.participantName ?? "Persona" : m.isAutoReply ? "IA" : "Dayana";
      const files = attachmentNames(m.attachments);
      const text = [files.length ? `[${files.join(", ")}]` : "", m.body ?? ""].filter(Boolean).join(" ");
      lines.push(`[${when(m.sentAt)}] ${who}: ${text}${m.status === "FAILED" ? " (no se envió)" : ""}`);
    }
    lines.push("");
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="respaldo-chats-whatsapp-${stamp}.txt"`,
    },
  });
});
