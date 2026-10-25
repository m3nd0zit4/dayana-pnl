"use client";

import { AlertTriangle, Check, Loader2, MessageSquarePlus, Receipt, X } from "lucide-react";
import { useState } from "react";
import { formatMoneyMinor } from "@/lib/crm/money";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import RegisterPaymentFlow from "../crm/RegisterPaymentFlow";
import type { PaymentPrefill } from "../crm/RegisterPaymentForm";
import { cn } from "@/lib/utils";
import { wa } from "./chat/chatTheme";
import { attachmentSrc } from "./chat/utils";

type PendingReceipt = ChatDetail["receipts"][number];

const DEFAULT_CONFIRM = (name: string) =>
  `Gracias, ${name}. Dayana confirmó tu pago ✅ En un momento te escribimos para coordinar lo que sigue.`;

const ERRORS: Record<string, string> = {
  no_phone: "Este chat no tiene número (usuario de WhatsApp sin teléfono): crea el contacto a mano y vincúlalo.",
  already_decided: "Ese comprobante ya estaba decidido.",
  already_linked: "Ese comprobante ya tiene su pago registrado.",
  other_contact: "Ese pago es de otro contacto: no se enlazó al comprobante.",
  payment_taken: "Ese pago ya está enlazado a otro comprobante.",
};

const prefillOf = (r: PendingReceipt): PaymentPrefill => ({
  amountMinor: r.amountMinor,
  currency: r.currency,
  reference: [r.method, r.reference ? `Ref. ${r.reference}` : null].filter(Boolean).join(" · ") || null,
  note: "Monto leído del comprobante",
});

/**
 * Un comprobante de pago que llegó por WhatsApp, encima de la caja de
 * escribir: lo que leyó la IA, la foto y «Confirmar pago». Confirmar deja a la
 * persona como contacto del CRM y clienta, y abre «Registrar pago» con el
 * monto leído: el pago queda en Pagos con el código del correo de Dayana. No
 * hace falta mandar ningún mensaje (es opcional).
 *
 * Si Dayana ya lo confirmó en el chat («he recibido»), o cerró el registro sin
 * terminar, queda la tarjeta corta «falta registrar el pago».
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
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** El comprobante cuyo pago se está registrando, con su contacto. */
  const [register, setRegister] = useState<{ receipt: PendingReceipt; contact: { id: string; name: string } } | null>(null);
  const firstName = chatName.split(/\s+/)[0] ?? chatName;

  if (receipts.length === 0 && !register) return null;

  const post = async (body: Record<string, string>) => {
    const res = await fetch("/api/admin/whatsapp/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) return { ok: true as const, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
    setError((code && ERRORS[code]) ?? "No se pudo guardar. Intenta de nuevo.");
    return { ok: false as const };
  };

  const decide = async (r: PendingReceipt, action: "confirm" | "reject") => {
    setBusy(`${r.id}:${action}`);
    setError(null);
    const message = writing[r.id] ? (messages[r.id] ?? r.confirmMessage ?? DEFAULT_CONFIRM(firstName)) : "";
    const result = await post({ action, receiptId: r.id, message });
    setBusy(null);
    if (result.ok && action === "confirm") {
      const contactId = result.data.contactId as string | null;
      // Enseguida el pago, con el monto que leyó la IA y el código de Dayana (no si ya entró por la página).
      if (contactId && !result.data.alreadyRegistered) {
        setRegister({ receipt: r, contact: { id: contactId, name: (result.data.contactName as string | null) ?? chatName } });
      }
    }
    onChanged();
  };

  const dismissPayment = async (r: PendingReceipt) => {
    setBusy(`${r.id}:dismiss`);
    setError(null);
    await post({ action: "dismiss_payment", receiptId: r.id });
    setBusy(null);
    onChanged();
  };

  const linkPayment = async (receiptId: string, paymentId: string) => {
    await post({ action: "link_payment", receiptId, paymentId });
    onChanged();
  };

  return (
    <div className="space-y-2">
      {receipts.map((r) => {
        const amount = r.amountMinor != null && r.currency ? formatMoneyMinor(r.amountMinor, r.currency) : null;

        if (r.needsPayment) {
          const who = r.contactName ?? chatName;
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-(--wa-green) bg-(--wa-surface) p-3 text-sm text-(--wa-text)">
              <Check className="size-4 shrink-0 text-(--wa-accent)" />
              <span className="min-w-0 flex-1">
                {r.confirmedVia === "chat" ? "Confirmaste este pago en el chat" : "Pago confirmado"}: {who} ya es clienta y está en el CRM.
                {" "}Falta registrarlo en Pagos{amount ? ` (${amount})` : ""} con tu código.
              </span>
              {canWrite && r.contactId && (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setRegister({ receipt: r, contact: { id: r.contactId!, name: who } })}
                    className={cn("inline-flex h-10 items-center rounded-full px-4 text-sm font-medium disabled:opacity-50 md:h-9", wa.primary)}
                  >
                    Registrar el pago
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void dismissPayment(r)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-(--wa-border) bg-(--wa-surface) px-4 text-sm font-medium text-(--wa-text) hover:bg-(--wa-hover) disabled:opacity-50 md:h-9"
                  >
                    {busy === `${r.id}:dismiss` && <Loader2 className="size-4 animate-spin" />} Ya está registrado
                  </button>
                </>
              )}
            </div>
          );
        }

        const src = r.attachment ? attachmentSrc(r.attachment) : null;
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
                {r.webPayment ? (
                  // Ya entró solo por la página (Gina, 25-oct): nada que verificar ni registrar.
                  <div className="flex items-start gap-1.5 rounded-lg bg-(--wa-green-soft) px-2 py-1.5 text-xs text-(--wa-text)">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-(--wa-accent)" />
                    <span>
                      Este pago ya entró por la página ({r.webPayment.provider} ·{" "}
                      {formatMoneyMinor(r.webPayment.amountMinor, r.webPayment.currency)}
                      {r.webPayment.product ? ` · ${r.webPayment.product}` : ""}) y ya está registrado. Al confirmar, este chat queda vinculado a
                      su ficha como clienta; no hay que registrarlo otra vez.
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-(--wa-meta)">
                    Verifica en tu cuenta que el dinero llegó. Al confirmar, la persona queda como contacto en el CRM y como clienta (la IA deja de
                    atenderla, salvo pagos) y registras el pago con el código que llega a tu correo.
                  </div>
                )}
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
                {writing[r.id] ? (
                  <>
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
                  </>
                ) : (
                  <p className="text-xs text-(--wa-meta)">
                    {r.dayanaReplied ? "Ya le respondiste en el chat: " : ""}al confirmar no se le envía ningún mensaje.{" "}
                    <button
                      type="button"
                      onClick={() => setWriting({ ...writing, [r.id]: true })}
                      className="inline-flex items-center gap-1 font-medium text-(--wa-accent) underline-offset-2 hover:underline"
                    >
                      <MessageSquarePlus className="size-3.5" /> Escribirle un mensaje
                    </button>
                  </p>
                )}
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
      {error && <p className="text-xs text-destructive">{error}</p>}
      {register && (
        <RegisterPaymentFlow
          open
          onClose={() => {
            setRegister(null);
            onChanged();
          }}
          contact={register.contact}
          prefill={prefillOf(register.receipt)}
          onSuccess={(payment) => {
            const receiptId = register.receipt.id;
            setRegister(null);
            void linkPayment(receiptId, payment.id);
          }}
        />
      )}
    </div>
  );
};

export default ReceiptBar;
