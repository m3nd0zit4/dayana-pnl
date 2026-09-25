"use client";

import { CalendarCheck, CalendarClock, Check, CreditCard, FilePen, Loader2, Pencil, Plus, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { Proposal } from "@/lib/crm/whatsapp-agent/approvals";

export type PendingApproval = {
  runId: string;
  createdAt: string;
  proposal: Proposal;
  /** `phone`: el CRM no puede enviarlo (sin ventana ni plantilla); sale desde el celular. */
  delivery?: "text" | "template" | "phone";
  phoneUrl?: string | null;
};


const PLACEHOLDER = "{{ENLACE_DE_PAGO}}";

const HEAD: Record<Proposal["kind"], { title: string; icon: typeof FilePen; hint: string }> = {
  reply: { title: "Borrador de la IA", icon: FilePen, hint: "Revísalo y envíalo, cámbialo o descártalo." },
  booking: {
    title: "La IA quiere agendar una cita",
    icon: CalendarCheck,
    hint: "Al aceptar se crea en tu Google Calendar y se envía la confirmación con el enlace de Meet.",
  },
  payment_link: {
    title: "La IA quiere mandar un enlace de pago",
    icon: CreditCard,
    hint: "Al aceptar se crea el enlace real y se envía el mensaje.",
  },
  payment_received: {
    title: "Dice que ya pagó",
    icon: ShieldCheck,
    hint: "Verifica el pago en tu cuenta. Al aceptar se envía esta respuesta y el chat vuelve a la IA.",
  },
  slots: {
    title: "La IA quiere ofrecer estos horarios",
    icon: CalendarClock,
    hint: "Deja, quita o agrega horas: solo esas le llegan a la persona, y solo esas se pueden agendar.",
  },
};

type Slot = { startIso: string; label: string };

const HORARIOS = "{{HORARIOS}}";

const slotLabel = (d: Date) =>
  d.toLocaleString("es-CO", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

/**
 * Lo que la IA propone y espera tu «sí», encima de la caja de escribir:
 * Aceptar (se envía, y si es una cita se agenda), Modificar (cambias el texto y
 * lo envías; la IA aprende del cambio) o Cancelar.
 */
const ApprovalBar = ({
  approvals,
  canWrite,
  onDecide,
}: {
  approvals: PendingApproval[];
  canWrite: boolean;
  onDecide: (
    runId: string,
    decision: "approve" | "reject" | "phone",
    message?: string,
    slots?: Slot[]
  ) => Promise<void>;
}) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Horarios por propuesta: los que propuso la IA (marcados o no) y los que agrega Dayana.
  const [extra, setExtra] = useState<Record<string, Slot[]>>({});
  const [off, setOff] = useState<Record<string, string[]>>({});
  const [adding, setAdding] = useState<Record<string, string>>({});

  if (approvals.length === 0) return null;

  const slotsOf = (runId: string, p: Proposal): { all: Slot[]; chosen: Slot[] } => {
    const all = [...(p.slots?.options ?? []), ...(extra[runId] ?? [])];
    const removed = off[runId] ?? [];
    return { all, chosen: all.filter((o) => !removed.includes(o.startIso)) };
  };

  const toggle = (runId: string, iso: string) => {
    const cur = off[runId] ?? [];
    setOff({ ...off, [runId]: cur.includes(iso) ? cur.filter((x) => x !== iso) : [...cur, iso] });
  };

  const addSlot = (runId: string) => {
    const v = adding[runId];
    if (!v) return;
    const d = new Date(v);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) return;
    const iso = d.toISOString();
    const cur = extra[runId] ?? [];
    if (!cur.some((o) => o.startIso === iso)) setExtra({ ...extra, [runId]: [...cur, { startIso: iso, label: slotLabel(d) }] });
    setAdding({ ...adding, [runId]: "" });
  };

  const decide = async (runId: string, decision: "approve" | "reject" | "phone", message?: string, slots?: Slot[]) => {
    setBusy(`${runId}:${decision}`);
    try {
      await onDecide(runId, decision, message, slots);
      setEditing(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {approvals.map(({ runId, proposal: p, delivery }) => {
        const head = HEAD[p.kind] ?? HEAD.reply;
        // Sin ventana de 24 h y sin plantilla aprobada, WhatsApp no deja que el
        // CRM escriba primero. No se manda a nadie a otra app: se dice por qué
        // y se envía desde aquí en cuanto Meta apruebe la plantilla.
        const blocked = delivery === "phone";
        const Icon = head.icon;
        const isEditing = editing === runId;
        const isSlots = p.kind === "slots";
        const { all: allSlots, chosen } = isSlots ? slotsOf(runId, p) : { all: [], chosen: [] };
        const slotList = chosen.map((o) => `• ${o.label}`).join("\n");
        const preview = p.message
          .split(PLACEHOLDER)
          .join("🔗 [enlace de pago]")
          .split(HORARIOS)
          .join(slotList || "(sin horas)");
        const approveSlots = isSlots ? chosen : undefined;
        const noSlots = isSlots && chosen.length === 0;
        return (
          <div
            key={runId}
            className="rounded-xl border-2 border-(--wa-green) bg-(--wa-surface) p-3 shadow-sm"
          >
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 size-5 shrink-0 text-(--wa-accent)" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-(--wa-text)">{head.title}</div>
                <div className="text-xs text-(--wa-meta)">
                  {blocked
                    ? "Aún no se le puede escribir desde el CRM: esta persona nunca te ha escrito (o pasaron más de 24 h) y la plantilla todavía no está aprobada por Meta. En cuanto la aprueben, «Aceptar y enviar» funciona aquí mismo; puedes dejarla lista o modificarla."
                    : delivery === "template"
                      ? "Pasaron más de 24 h: al aceptar se envía con la plantilla aprobada."
                      : head.hint}
                </div>
                {p.kind === "booking" && p.booking && (
                  <div className="mt-1.5 inline-flex flex-wrap items-center gap-2 rounded-lg bg-(--wa-green-soft) px-2.5 py-1 text-sm font-medium text-(--wa-green-ink)">
                    <CalendarCheck className="size-4" /> {p.booking.service} · {p.booking.label}
                    {p.booking.name ? ` · ${p.booking.name}` : ""}
                  </div>
                )}
                {p.kind === "payment_link" && p.payment && (
                  <div className="mt-1.5 inline-flex items-center gap-2 rounded-lg bg-(--wa-green-soft) px-2.5 py-1 text-sm font-medium text-(--wa-green-ink)">
                    <CreditCard className="size-4" /> {p.payment.product}
                  </div>
                )}
                {p.kind === "payment_received" && p.reason && (
                  <div className="mt-1.5 text-sm text-(--wa-icon)">{p.reason}</div>
                )}
              </div>
            </div>

            {isSlots && (
              <div className="mt-2 space-y-1.5">
                {p.slots?.service && <div className="text-xs font-medium text-(--wa-meta)">{p.slots.service}</div>}
                <ul className="space-y-1">
                  {allSlots.map((o) => {
                    const on = chosen.some((c) => c.startIso === o.startIso);
                    return (
                      <li key={o.startIso}>
                        <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-(--wa-panel) px-3 py-1.5 text-sm text-(--wa-text) md:min-h-9">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!canWrite || busy !== null}
                            onChange={() => toggle(runId, o.startIso)}
                            className="size-4 accent-(--wa-green)"
                          />
                          <span className={on ? "" : "text-(--wa-meta) line-through"}>{o.label}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {canWrite && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="datetime-local"
                      step={900}
                      value={adding[runId] ?? ""}
                      onChange={(e) => setAdding({ ...adding, [runId]: e.target.value })}
                      className="h-10 rounded-lg border border-(--wa-border) bg-(--wa-surface) px-2 text-base text-(--wa-text) md:h-9 md:text-sm"
                    />
                    <button
                      type="button"
                      disabled={busy !== null || !adding[runId]}
                      onClick={() => addSlot(runId)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-(--wa-border) bg-(--wa-surface) px-3 text-sm font-medium text-(--wa-text) hover:bg-(--wa-hover) disabled:opacity-50 md:h-9"
                    >
                      <Plus className="size-4" /> Otro horario
                    </button>
                  </div>
                )}
              </div>
            )}

            {isEditing ? (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="mt-2 w-full rounded-lg border border-(--wa-border) bg-(--wa-surface) p-2 text-sm outline-none focus:border-(--wa-green)"
              />
            ) : (
              <p className="mt-2 rounded-lg bg-(--wa-panel) px-3 py-2 text-sm whitespace-pre-wrap text-(--wa-text)">
                {preview}
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              {isEditing ? (
                <button
                  type="button"
                  disabled={!canWrite || busy !== null || !text.trim() || blocked || noSlots}
                  onClick={() => void decide(runId, "approve", text, approveSlots)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full md:h-9 bg-(--wa-green) px-4 text-sm font-medium text-white hover:bg-(--wa-green-strong) disabled:opacity-50"
                >
                  {busy === `${runId}:approve` ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {p.kind === "booking" ? "Agendar y enviar mi versión" : "Enviar mi versión"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canWrite || busy !== null || blocked || noSlots}
                  onClick={() => void decide(runId, "approve", undefined, approveSlots)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full md:h-9 bg-(--wa-green) px-4 text-sm font-medium text-white hover:bg-(--wa-green-strong) disabled:opacity-50"
                >
                  {busy === `${runId}:approve` ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {blocked
                    ? "Esperando plantilla"
                    : p.kind === "booking"
                      ? "Aceptar: agendar y enviar"
                      : isSlots
                        ? `Enviar ${chosen.length === 1 ? "este horario" : `estos ${chosen.length} horarios`}`
                        : "Aceptar y enviar"}
                </button>
              )}
              <button
                type="button"
                disabled={!canWrite || busy !== null}
                onClick={() => {
                  if (isEditing) {
                    setEditing(null);
                  } else {
                    setEditing(runId);
                    setText(p.message);
                  }
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-full md:h-9 border border-(--wa-border) bg-(--wa-surface) px-4 text-sm font-medium text-(--wa-text) hover:bg-(--wa-hover) disabled:opacity-50"
              >
                <Pencil className="size-4" /> {isEditing ? "Dejar como estaba" : "Modificar"}
              </button>
              <button
                type="button"
                disabled={!canWrite || busy !== null}
                onClick={() => void decide(runId, "reject")}
                className="inline-flex h-10 items-center gap-1.5 rounded-full md:h-9 border border-(--wa-danger-border) bg-(--wa-surface) px-4 text-sm font-medium text-(--wa-danger-ink) hover:bg-(--wa-danger-soft) disabled:opacity-50"
              >
                {busy === `${runId}:reject` ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                Cancelar
              </button>
            </div>
            {isEditing && isSlots && (
              <p className="mt-1 text-[11px] text-(--wa-meta)">
                Deja {HORARIOS} donde van las horas (si lo quitas, se agregan al final).
              </p>
            )}
            {isEditing && p.kind === "payment_link" && (
              <p className="mt-1 text-[11px] text-(--wa-meta)">
                Deja {PLACEHOLDER} donde va el enlace (si lo quitas, se agrega al final).
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ApprovalBar;
