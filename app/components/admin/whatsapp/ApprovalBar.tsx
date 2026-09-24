"use client";

import { CalendarCheck, Check, CreditCard, FilePen, Loader2, Pencil, ShieldCheck, X } from "lucide-react";
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

/** wa.me con el texto que quedó (el de la IA o el modificado). */
const withText = (url: string, message: string) => {
  try {
    const u = new URL(url);
    u.searchParams.set("text", message);
    return u.toString();
  } catch {
    return url;
  }
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
};

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
  onDecide: (runId: string, decision: "approve" | "reject" | "phone", message?: string) => Promise<void>;
}) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (approvals.length === 0) return null;

  const decide = async (runId: string, decision: "approve" | "reject" | "phone", message?: string) => {
    setBusy(`${runId}:${decision}`);
    try {
      await onDecide(runId, decision, message);
      setEditing(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {approvals.map(({ runId, proposal: p, delivery, phoneUrl }) => {
        const head = HEAD[p.kind] ?? HEAD.reply;
        const byPhone = delivery === "phone" && Boolean(phoneUrl);
        // Se abre en el mismo clic (si no, el navegador bloquea la ventana).
        const openPhone = (message: string) => {
          if (phoneUrl) window.open(withText(phoneUrl, message), "_blank", "noopener,noreferrer");
          void decide(runId, "phone", message);
        };
        const Icon = head.icon;
        const isEditing = editing === runId;
        const preview = p.message.split(PLACEHOLDER).join("🔗 [enlace de pago]");
        return (
          <div
            key={runId}
            className="rounded-xl border-2 border-[#00a884] bg-white p-3 shadow-sm dark:bg-card"
          >
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 size-5 shrink-0 text-[#008069]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#111b21] dark:text-foreground">{head.title}</div>
                <div className="text-xs text-[#667781]">
                  {byPhone
                    ? "Todavía no se le puede escribir desde el CRM (sin plantilla aprobada). Al aceptar se abre tu WhatsApp con el mensaje escrito: solo pulsa enviar. Es gratis y el mensaje aparece aquí."
                    : delivery === "template"
                      ? "Pasaron más de 24 h: al aceptar se envía con la plantilla aprobada."
                      : head.hint}
                </div>
                {p.kind === "booking" && p.booking && (
                  <div className="mt-1.5 inline-flex flex-wrap items-center gap-2 rounded-lg bg-[#d9fdd3] px-2.5 py-1 text-sm font-medium text-[#006e4f]">
                    <CalendarCheck className="size-4" /> {p.booking.service} · {p.booking.label}
                    {p.booking.name ? ` · ${p.booking.name}` : ""}
                  </div>
                )}
                {p.kind === "payment_link" && p.payment && (
                  <div className="mt-1.5 inline-flex items-center gap-2 rounded-lg bg-[#d9fdd3] px-2.5 py-1 text-sm font-medium text-[#006e4f]">
                    <CreditCard className="size-4" /> {p.payment.product}
                  </div>
                )}
                {p.kind === "payment_received" && p.reason && (
                  <div className="mt-1.5 text-sm text-[#54656f]">{p.reason}</div>
                )}
              </div>
            </div>

            {isEditing ? (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="mt-2 w-full rounded-lg border border-[#d1d7db] bg-white p-2 text-sm outline-none focus:border-[#00a884] dark:border-border dark:bg-card"
              />
            ) : (
              <p className="mt-2 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm whitespace-pre-wrap text-[#111b21] dark:bg-muted/40 dark:text-foreground">
                {preview}
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              {isEditing ? (
                <button
                  type="button"
                  disabled={!canWrite || busy !== null || !text.trim()}
                  onClick={() => (byPhone ? openPhone(text) : void decide(runId, "approve", text))}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-50"
                >
                  {busy === `${runId}:approve` ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {byPhone ? "Enviar mi versión desde mi celular" : p.kind === "booking" ? "Agendar y enviar mi versión" : "Enviar mi versión"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canWrite || busy !== null}
                  onClick={() => (byPhone ? openPhone(p.message) : void decide(runId, "approve"))}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-50"
                >
                  {busy === `${runId}:approve` ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {byPhone ? "Enviar desde mi celular" : p.kind === "booking" ? "Aceptar: agendar y enviar" : "Aceptar y enviar"}
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
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#d1d7db] bg-white px-4 text-sm font-medium text-[#111b21] hover:bg-[#f5f6f6] disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground"
              >
                <Pencil className="size-4" /> {isEditing ? "Dejar como estaba" : "Modificar"}
              </button>
              <button
                type="button"
                disabled={!canWrite || busy !== null}
                onClick={() => void decide(runId, "reject")}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#f3b9b4] bg-white px-4 text-sm font-medium text-[#b42318] hover:bg-[#fef3f2] disabled:opacity-50"
              >
                {busy === `${runId}:reject` ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                Cancelar
              </button>
            </div>
            {isEditing && p.kind === "payment_link" && (
              <p className="mt-1 text-[11px] text-[#667781]">
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
