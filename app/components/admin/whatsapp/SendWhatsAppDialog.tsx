"use client";

import { Loader2, MessageCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { resolvePresetVars } from "@/lib/crm/whatsapp-presets";
import CrmModal from "../crm/CrmModal";
import { useCrm } from "../crm/CrmProvider";

export type WhatsAppPreset = {
  id: string;
  label: string;
  /** Texto libre (dentro de 24 h). Admite {{nombre}} y las variables de `vars`. */
  text: string;
  /** Plantilla para quien está fuera de las 24 h. */
  templateKey?: string | null;
  vars?: Record<string, string>;
};

type Plan =
  | { action: "text" }
  | { action: "template" }
  | { action: "skip"; reason: "no_phone" | "opted_out" | "needs_template" };

const SKIP_TEXT = {
  no_phone: "Esta persona no tiene un número de WhatsApp válido en su ficha.",
  opted_out: "Esta persona pidió no recibir mensajes por WhatsApp.",
  needs_template:
    "Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja escribirle con una plantilla aprobada, y esta no tiene. Créala en WhatsApp → Plantillas.",
};

/**
 * Enviar un WhatsApp a una persona desde cualquier pantalla del CRM, de verdad
 * (no abre el celular). Dice antes si va gratis (dentro de 24 h), si va por
 * plantilla (y cuánto cuesta) o si no se puede.
 */
const SendWhatsAppDialog = ({
  contactId,
  name,
  presets,
  source,
  open,
  onClose,
  onSent,
}: {
  contactId: string;
  name?: string | null;
  presets: WhatsAppPreset[];
  source: string;
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
}) => {
  const { toast } = useCrm();
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "libre");
  const preset = presets.find((p) => p.id === presetId) ?? null;
  const [text, setText] = useState(preset?.text ?? "");
  const [info, setInfo] = useState<{ plan: Plan; price: number; currency: string; template: { title: string; body: string } | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(preset?.text ?? "");
  }, [presetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setInfo(null);
    const params = new URLSearchParams({ contactId });
    if (preset?.templateKey) params.set("templateKey", preset.templateKey);
    void fetch(`/api/admin/whatsapp/send?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInfo(d));
  }, [open, contactId, preset?.templateKey]);

  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          text,
          templateKey: preset?.templateKey ?? null,
          vars: resolvePresetVars(preset?.vars, text),
          source,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; reason?: keyof typeof SKIP_TEXT; error?: string; mode?: string };
      if (data.status === "sent") {
        toast(data.mode === "template" ? "Enviado con plantilla" : "Enviado por WhatsApp", "success");
        onSent?.();
        onClose();
      } else if (data.status === "skipped" && data.reason) {
        toast(SKIP_TEXT[data.reason], "error");
      } else {
        toast(`No se pudo enviar: ${data.error ?? "error"}`, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const plan = info?.plan;
  const usesTemplate = plan?.action === "template";

  return (
    <CrmModal title={`WhatsApp a ${name ?? "esta persona"}`} open={open} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {presets.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${presetId === p.id ? "bg-[#00a884] text-white" : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {usesTemplate && info?.template ? (
          <div className="space-y-1">
            <p className="text-xs text-[#54656f]">
              Pasaron más de 24 h desde su último mensaje: va con la plantilla aprobada «{info.template.title}»
              {info.price > 0 ? ` (≈ ${info.price} ${info.currency})` : ""}.
            </p>
            <p className="rounded-lg bg-[#d9fdd3] px-3 py-2 whitespace-pre-wrap text-[#111b21]">{info.template.body}</p>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Escribe el mensaje. Puedes usar {{nombre}}."
            className="w-full rounded-lg border border-[#d1d7db] bg-white p-2.5 outline-none focus:border-[#00a884] dark:border-border dark:bg-card"
          />
        )}

        {!info && <Loader2 className="size-4 animate-spin text-[#00a884]" />}
        {plan?.action === "text" && (
          <p className="text-xs text-[#008069]">Escribió en las últimas 24 h: va como mensaje normal, gratis.</p>
        )}
        {plan?.action === "skip" && <p className="text-xs text-[#d92d20]">{SKIP_TEXT[plan.reason]}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-full px-4 text-[#54656f] hover:bg-[#f5f6f6]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !plan || plan.action === "skip" || (!usesTemplate && !text.trim())}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 font-medium text-white hover:bg-[#008069] disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Enviar
          </button>
        </div>
      </div>
    </CrmModal>
  );
};

/** Botón que abre el envío a una persona. */
export const SendWhatsAppButton = ({
  label = "Enviar WhatsApp",
  small,
  ...props
}: Omit<Parameters<typeof SendWhatsAppDialog>[0], "open" | "onClose"> & { label?: string; small?: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          small
            ? "inline-flex items-center gap-1 rounded-full bg-[#d9fdd3] px-2.5 py-1 text-xs font-medium text-[#008069] hover:bg-[#c5f5bd]"
            : "inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069]"
        }
      >
        <MessageCircle className={small ? "size-3.5" : "size-4"} /> {label}
      </button>
      {open && <SendWhatsAppDialog {...props} open={open} onClose={() => setOpen(false)} />}
    </>
  );
};

export default SendWhatsAppDialog;
