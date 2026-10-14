"use client";

import { AlertTriangle, Check, Loader2, Receipt, X } from "lucide-react";
import { useState } from "react";
import { formatMoneyMinor } from "@/lib/crm/money";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import RegisterPaymentFlow from "../crm/RegisterPaymentFlow";
import { cn } from "@/lib/utils";
import { wa } from "./chat/chatTheme";
import { attachmentSrc } from "./chat/utils";

type PendingReceipt = ChatDetail["receipts"][number];

const DEFAULT_CONFIRM = (name: string) =>
  `Gracias, ${name}. Dayana confirmó tu pago ✅ En un momento te escribimos para coordinar lo que sigue.`;

/**
 * Un comprobante de pago que llegó por WhatsApp y espera a Dayana, encima de
 * la caja de escribir: lo que leyó la IA, la foto, y «Confirmar pago» (la
 * persona queda como contacto y clienta, y sale el mensaje si lo dejas) o «No
 * es válido». Después de confirmar, «Registrar el monto» abre el mismo
 * «Registrar pago» del CRM con el contacto ya elegido.
 */
const ReceiptBar = ({
  receipts,
  chatName,
  canWrite,
  onChanged,
  onOpenImage,
}: {
  receipts: PendingReceipt[];
  chatName: string;
  canWrite: boolean;
  onChanged: () => void;
  onOpenImage?: (image: { src: string; alt: string }) => void;
}) => {
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ id: string; name: string } | null>(null);
  const [register, setRegister] = useState(false);
  const firstName = chatName.split(/\s+/)[0] ?? chatName;

  if (receipts.length === 0 && !confirmed) return null;

  const decide = async (r: PendingReceipt, action: "confirm" | "reject") => {
    setBusy(`${r.id}:${action}`);
    setError(null);
    const message = action === "confirm" ? (messages[r.id] ?? r.confirmMessage ?? DEFAULT_CONFIRM(firstName)) : messages[r.id] ?? "";
    const res = await fetch("/api/admin/whatsapp/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, receiptId: r.id, message }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
      setError(
        code === "no_phone"
          ? "Este chat no tiene número (usuario de WhatsApp sin teléfono): crea el contacto a mano y vincúlalo."
          : code === "already_decided"
            ? "Ese comprobante ya estaba decidido."
            : "No se pudo guardar. Intenta de nuevo."
      );
      onChanged();
      return;
    }
    const data = (await res.json()) as { contactId: string | null; contactName: string | null };
    if (action === "confirm" && data.contactId) setConfirmed({ id: data.contactId, name: data.contactName ?? chatName });
    onChanged();
  };

  return (
    <div className="space-y-2">
      {receipts.map((r) => {
        const src = r.attachment ? attachmentSrc(r.attachment) : null;
        const amount = r.amountMinor != null && r.currency ? formatMoneyMinor(r.amountMinor, r.currency) : null;
        const facts = [r.method, amount, r.paidOn, r.reference ? `Ref. ${r.reference}` : null, r.payerName ? `De ${r.payerName}` : null].filter(
          Boolean
        );
        const message = messages[r.id] ?? r.confirmMessage ?? DEFAULT_CONFIRM(firstName);
        return (
          <div key={r.id} className="rounded-xl border-2 border-(--wa-attention) bg-(--wa-surface) p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <Receipt className="mt-0.5 size-5 shrink-0 text-(--wa-attention)" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-semibold text-(--wa-text)">Comprobante de pago por confirmar</div>
                <div className="text-xs text-(--wa-meta)">
                  Verifica en tu cuenta que el dinero llegó. Al confirmar, la persona queda como contacto en el CRM y como clienta (la IA deja de atenderla, salvo pagos).
                </div>
                {r.summary && <div className="text-sm text-(--wa-text)">{r.summary}</div>}
                {facts.length > 0 && <div className="text-xs text-(--wa-icon)">{facts.join(" · ")}</div>}
                {r.problem && (
                  <div className="flex items-start gap-1.5 rounded-lg bg-(--wa-attention-soft) px-2 py-1.5 text-xs text-(--wa-text)">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--wa-attention)" /> {r.problem}
                  </div>
                )}
              </div>
              {src && (r.attachment?.kind === "image" ? (
                <button
                  type="button"
                  onClick={() => onOpenImage?.({ src, alt: "Comprobante" })}
                  className="shrink-0 overflow-hidden rounded-md"
                  aria-label="Ver el comprobante en grande"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="Comprobante" className="size-16 object-cover" loading="lazy" />
                </button>
              ) : (
                <a href={src} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-(--wa-accent) underline">
                  Ver archivo
                </a>
              ))}
            </div>
            {canWrite && (
              <div className="mt-2 space-y-2">
                <label className="block text-xs font-medium text-(--wa-meta)" htmlFor={`receipt-msg-${r.id}`}>
                  Mensaje para {firstName} al confirmar (vacío = no se envía nada)
                </label>
                <textarea
                  id={`receipt-msg-${r.id}`}
                  rows={2}
                  value={message}
                  onChange={(e) => setMessages({ ...messages, [r.id]: e.target.value })}
                  className="w-full rounded-lg border border-(--wa-border) bg-(--wa-input) p-2 text-base text-(--wa-text) outline-none focus:border-(--wa-green) md:text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void decide(r, "confirm")}
                    className={cn("inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium disabled:opacity-50 md:h-9", wa.primary)}
                  >
                    {busy === `${r.id}:confirm` ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Confirmar pago
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void decide(r, "reject")}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-(--wa-border) bg-(--wa-surface) px-4 text-sm font-medium text-(--wa-text) hover:bg-(--wa-hover) disabled:opacity-50 md:h-9"
                  >
                    {busy === `${r.id}:reject` ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} No es válido
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {confirmed && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-(--wa-green) bg-(--wa-surface) p-3 text-sm text-(--wa-text)">
          <Check className="size-4 text-(--wa-accent)" />
          <span className="flex-1">Pago confirmado: {confirmed.name} ya es clienta y está en el CRM. Registra el monto para que cuente en Pagos.</span>
          <button
            type="button"
            onClick={() => setRegister(true)}
            className={cn("inline-flex h-10 items-center rounded-full px-4 text-sm font-medium md:h-9", wa.primary)}
          >
            Registrar el monto
          </button>
          <button
            type="button"
            onClick={() => setConfirmed(null)}
            aria-label="Cerrar"
            className="grid size-9 place-items-center rounded-full text-(--wa-icon) hover:bg-(--wa-hover)"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {confirmed && (
        <RegisterPaymentFlow
          open={register}
          onClose={() => setRegister(false)}
          contact={{ id: confirmed.id, name: confirmed.name }}
          onSuccess={() => {
            setRegister(false);
            setConfirmed(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
};

export default ReceiptBar;
