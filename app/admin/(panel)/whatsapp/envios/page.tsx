import Link from "next/link";

import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  SENT: "Enviado",
  NEEDS_TEMPLATE: "Sin plantilla aprobada",
  NO_PHONE: "Sin número",
  OPTED_OUT: "Pidió no recibir",
  FAILED: "Falló",
  PENDING: "Pendiente",
  SENDING: "Enviando",
  CANCELLED: "Cancelado",
};

const fmt = (d: Date) =>
  d.toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });

/** Historial de envíos por WhatsApp desde el CRM y, al abrir uno, qué pasó con cada persona. */
const Page = async ({ searchParams }: { searchParams: Promise<{ id?: string }> }) => {
  const { id } = await searchParams;
  const sends = await prisma.whatsAppSend.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
  const detail = id
    ? await prisma.whatsAppSend.findUnique({
        where: { id },
        include: { recipients: { orderBy: [{ status: "asc" }, { name: "asc" }] } },
      })
    : null;
  const messages = detail
    ? await prisma.conversationMessage.findMany({
        where: { id: { in: detail.recipients.map((r) => r.messageId).filter((m): m is string => Boolean(m)) } },
        select: { id: true, status: true, conversationId: true },
      })
    : [];
  const byMessage = new Map(messages.map((m) => [m.id, m]));

  return (
    <CrmPageShell>
      <h1 className="text-xl font-semibold">Envíos por WhatsApp</h1>
      {sends.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay envíos. Se hacen desde Eventos gratuitos → Inscritas, Talleres, Diagnósticos o la ficha de cada
          persona.
        </p>
      ) : (
        <ul className="divide-y divide-[#f0f2f5] rounded-xl border border-[#e9edef] bg-white dark:divide-border dark:border-border dark:bg-card">
          {sends.map((s) => (
            <li key={s.id}>
              <Link
                href={`/admin/whatsapp/envios?id=${s.id}`}
                className={`flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm hover:bg-[#f5f6f6] ${s.id === id ? "bg-[#f0f2f5]" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                <span className="text-xs text-[#667781]">{fmt(s.createdAt)}</span>
                <span className="text-xs">
                  ✅ {s.sent} · ⏭ {s.skipped} · ❌ {s.failed} de {s.total}
                </span>
                <span className="rounded-full bg-[#f0f2f5] px-2 py-0.5 text-xs text-[#54656f]">
                  {s.status === "DONE" ? "Terminado" : s.status === "CANCELLED" ? "Cancelado" : "En curso"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {detail && (
        <section className="space-y-2">
          <h2 className="font-semibold">{detail.title}</h2>
          <p className="rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm whitespace-pre-wrap">{detail.text}</p>
          <ul className="divide-y divide-[#f0f2f5] rounded-xl border border-[#e9edef] bg-white text-sm dark:divide-border dark:border-border dark:bg-card">
            {detail.recipients.map((r) => {
              const msg = r.messageId ? byMessage.get(r.messageId) : null;
              const delivery =
                msg?.status === "READ" ? "Leído" : msg?.status === "DELIVERED" ? "Entregado" : msg?.status === "FAILED" ? "No entregado" : null;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  {r.contactId ? (
                    <Link href={`/admin/contacts/${r.contactId}`} className="min-w-0 flex-1 truncate hover:underline">
                      {r.name ?? r.phone ?? "—"}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{r.name ?? r.phone ?? "—"}</span>
                  )}
                  <span className="text-xs text-[#667781]">{r.mode === "template" ? "con plantilla" : r.mode === "text" ? "texto" : ""}</span>
                  <span className={`text-xs ${r.status === "SENT" ? "text-[#008069]" : r.status === "FAILED" ? "text-[#d92d20]" : "text-[#54656f]"}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                    {delivery ? ` · ${delivery}` : ""}
                  </span>
                  {msg?.conversationId && (
                    <Link href={`/admin/whatsapp?conversation=${msg.conversationId}`} className="text-xs font-medium text-[#008069] hover:underline">
                      Chat
                    </Link>
                  )}
                  {r.error && <span className="w-full text-xs text-[#d92d20]">{r.error}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </CrmPageShell>
  );
};

export default Page;
