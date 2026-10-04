"use client";

import { Loader2, MessageCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { LINK_SLOT, presetMissingLink, presetNeedsMessage, resolvePresetVars } from "@/lib/crm/whatsapp-presets";
import PresetMessageField from "./PresetMessageField";
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
  /** Su plantilla lleva imagen: solo el envío masivo la ofrece. */
  imageTemplate?: boolean;
};

type Plan =
  | { action: "text" }
  | { action: "template" }
  | { action: "skip"; reason: "no_phone" | "opted_out" | "needs_template" };

const SKIP_TEXT = {
  no_phone: "Esta persona no tiene un número de WhatsApp válido en su ficha.",
  opted_out: "Esta persona pidió no recibir mensajes por WhatsApp.",
  needs_template:
    "Esta persona no te ha escrito en las últimas 24 h: WhatsApp solo deja escribirle con una plantilla aprobada por Meta, y esta aún no lo está (WhatsApp → Plantillas). Se podrá enviar desde aquí en cuanto la aprueben.",
};

/**
 * Enviar un WhatsApp a una persona desde cualquier pantalla del CRM, de verdad
 * (no abre el celular). Dice antes si va gratis (dentro de 24 h), si va por
 * plantilla (y cuánto cuesta) o si no se puede.
 */
const SendWhatsAppDialog = ({
  contactId,
  name,
  presets: allPresets,
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
  // Aquí no se sube imagen: los mensajes con plantilla de imagen, solo en el masivo.
  const presets = allPresets.filter((p) => !p.imageTemplate);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "libre");
  const preset = presets.find((p) => p.id === presetId) ?? null;
  const [text, setText] = useState(preset?.text ?? "");
  const [mensaje, setMensaje] = useState("");
  const needsMessage = presetNeedsMessage(preset);
  const [info, setInfo] = useState<{
    plan: Plan;
    price: number;
    currency: string;
    template: { title: string; body: string } | null;
    recipient?: { name: string | null; phone: string | null };
  } | null>(null);
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
          vars: resolvePresetVars(preset?.vars, text, mensaje),
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
  // El enlace que pide la plantilla sale de la caja (grabación de un evento
  // pasado): con plantilla la caja tiene que seguir a la vista.
  const needsLink = Boolean(preset?.vars && Object.values(preset.vars).includes(LINK_SLOT));
  const missingLink = presetMissingLink(preset, text);

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
                className={`h-10 rounded-full px-3 text-xs font-medium md:h-7 ${presetId === p.id ? "bg-[#00a884] text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {usesTemplate && info?.template ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Pasaron más de 24 h desde su último mensaje: va con la plantilla aprobada «{info.template.title}»
              {info.price > 0 ? ` (≈ ${info.price} ${info.currency})` : ""}.
            </p>
            <p className="rounded-lg bg-[#d9fdd3] px-3 py-2 whitespace-pre-wrap text-[#111b21]">{info.template.body}</p>
          </div>
        ) : null}
        {needsMessage && <PresetMessageField value={mensaje} onChange={setMensaje} />}
        {usesTemplate && info?.template && !needsLink ? null : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Escribe el mensaje. Puedes usar {{nombre}}."
            className="w-full rounded-lg border border-border bg-card p-2.5 text-base outline-none focus:border-[#00a884] md:text-sm"
          />
        )}
        {missingLink && (
          <p className="text-xs text-destructive">
            Pega en el mensaje el enlace de la grabación o del material{usesTemplate ? ": va en la plantilla" : ""}.
          </p>
        )}

        {!info && <Loader2 className="size-4 animate-spin text-[#00a884]" />}
        {plan?.action === "text" && (
          <p className="text-xs text-success">Escribió en las últimas 24 h: va como mensaje normal, gratis.</p>
        )}
        {plan?.action === "skip" && <p className="text-xs text-destructive">{SKIP_TEXT[plan.reason]}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-full px-4 text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={
              busy ||
              !plan ||
              plan.action === "skip" ||
              (!usesTemplate && !text.trim()) ||
              missingLink ||
              (needsMessage && !mensaje.trim())
            }
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
            ? // 40 px en el teléfono: es el botón de cada fila de la lista.
              "inline-flex h-10 items-center gap-1 rounded-full bg-[#d9fdd3] px-3 text-xs font-medium text-[#008069] hover:bg-[#c5f5bd] md:h-7 md:px-2.5"
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
