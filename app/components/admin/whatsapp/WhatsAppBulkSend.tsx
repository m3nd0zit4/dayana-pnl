"use client";

import { CheckCircle2, Loader2, MessageCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { resolvePresetVars } from "@/lib/crm/whatsapp-presets";
import CrmModal from "../crm/CrmModal";
import { useCrm } from "../crm/CrmProvider";
import type { WhatsAppPreset } from "./SendWhatsAppDialog";

type Preview = {
  total: number;
  text: number;
  template: number;
  skipped: { no_phone: number; opted_out: number; needs_template: number };
  estimatedCost: number;
  currency: string;
  templateInfo: { key: string; title: string; category: string | null; status: string | null } | null;
  phoneOnly: { contactId: string; name: string | null; phone: string; suggested: string | null }[];
};

type Progress = { status: string; total: number; sent: number; failed: number; skipped: number; pending: number };

/**
 * Enviar por WhatsApp a varias personas a la vez (inscritas de un evento,
 * alumnas de un taller, diagnósticos…). Muestra antes cuántos van gratis,
 * cuántos con plantilla (y el costo) y cuántos no se pueden; al confirmar
 * envía por tandas con barra de progreso.
 */
const WhatsAppBulkSend = ({
  contactIds,
  presets,
  kind,
  title,
  onDone,
  label = "Enviar por WhatsApp",
  create,
}: {
  contactIds: string[];
  presets: WhatsAppPreset[];
  kind: "evento" | "taller" | "diagnostico" | "pago" | "libre" | "comunidad";
  title: string;
  onDone?: () => void;
  label?: string;
  /**
   * Arma el envío en otra ruta (p. ej. la comunidad, que además deja a cada
   * persona como invitada). Devuelve el id del envío; las tandas son las de siempre.
   */
  create?: (input: { contactIds: string[]; text: string; templateKey: string | null }) => Promise<{ id: string }>;
}) => {
  const { toast } = useCrm();
  const [open, setOpen] = useState(false);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  const [text, setText] = useState(preset?.text ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => setText(preset?.text ?? ""), [presetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || contactIds.length === 0) return;
    setPreview(null);
    void fetch("/api/admin/whatsapp/sends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", contactIds, templateKey: preset?.templateKey ?? null, kind }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPreview(d as Preview));
  }, [open, contactIds, preset?.templateKey]);

  const run = async () => {
    setRunning(true);
    try {
      const { id } = create
        ? await create({ contactIds, text, templateKey: preset?.templateKey ?? null })
        : await fetch("/api/admin/whatsapp/sends", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create",
              contactIds,
              templateKey: preset?.templateKey ?? null,
              title: `${title} · ${preset?.label ?? ""}`.trim(),
              kind,
              text,
              vars: resolvePresetVars(preset?.vars, text),
            }),
          }).then(async (res) => {
            if (!res.ok) throw new Error();
            return (await res.json()) as { id: string };
          });
      for (;;) {
        const step = await fetch(`/api/admin/whatsapp/sends/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "next" }),
        });
        if (!step.ok) throw new Error();
        const p = (await step.json()) as Progress;
        setProgress(p);
        if (p.pending === 0 || p.status === "DONE" || p.status === "CANCELLED") break;
      }
      toast("Envío terminado", "success");
      onDone?.();
    } catch {
      toast("El envío se interrumpió. Puedes volver a intentarlo: no se repite a quien ya le llegó.", "error");
    } finally {
      setRunning(false);
    }
  };

  const toSend = preview ? preview.text + preview.template : 0;
  const done = progress && progress.pending === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setProgress(null);
          setOpen(true);
        }}
        disabled={contactIds.length === 0}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-40"
      >
        <MessageCircle className="size-4" /> {label}
        {contactIds.length > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{contactIds.length}</span>}
      </button>

      <CrmModal title={`WhatsApp a ${contactIds.length} personas`} open={open} onClose={() => !running && setOpen(false)} large>
        <div className="space-y-3 text-sm">
          {!progress && (
            <>
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
              <label className="block space-y-1">
                <span className="text-xs text-[#54656f]">
                  Mensaje para quien escribió en las últimas 24 h (gratis). {"{{nombre}}"} pone su nombre.
                </span>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg border border-[#d1d7db] bg-white p-2.5 outline-none focus:border-[#00a884] dark:border-border dark:bg-card"
                />
              </label>

              {!preview ? (
                <Loader2 className="size-4 animate-spin text-[#00a884]" />
              ) : (
                <div className="space-y-1.5 rounded-lg bg-[#f0f2f5] p-3 dark:bg-muted/40">
                  <div className="font-medium text-[#111b21] dark:text-foreground">A quién le llega</div>
                  <div>✅ {preview.text} con el mensaje de arriba (gratis, escribieron hace menos de 24 h)</div>
                  <div>
                    📨 {preview.template} con la plantilla{" "}
                    {preview.templateInfo ? `«${preview.templateInfo.title}»` : ""}
                    {preview.template > 0 && preview.estimatedCost > 0
                      ? ` · costo aprox. ${preview.estimatedCost} ${preview.currency}`
                      : ""}
                  </div>
                  {preview.skipped.needs_template > 0 && (
                    <div className="text-[#d92d20]">
                      ⚠️ {preview.skipped.needs_template} no se pueden: pasaron más de 24 h y{" "}
                      {preview.templateInfo
                        ? `la plantilla «${preview.templateInfo.title}» está ${preview.templateInfo.status === "APPROVED" ? "aprobada" : "en revisión o rechazada"}`
                        : "no hay plantilla para esto"}
                      . Créala o revísala en WhatsApp → Plantillas.
                    </div>
                  )}
                  {preview.skipped.no_phone > 0 && <div className="text-[#54656f]">— {preview.skipped.no_phone} sin número de WhatsApp</div>}
                  {preview.skipped.opted_out > 0 && <div className="text-[#54656f]">— {preview.skipped.opted_out} pidieron no recibir mensajes</div>}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-full px-4 text-[#54656f] hover:bg-[#f5f6f6]">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={!preview || toSend === 0 || running || !text.trim()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 font-medium text-white hover:bg-[#008069] disabled:opacity-50"
                >
                  <Send className="size-4" /> Enviar a {toSend}
                </button>
              </div>
            </>
          )}

          {progress && (
            <div className="space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-[#e9edef]">
                <div
                  className="h-full bg-[#00a884] transition-all"
                  style={{ width: `${progress.total ? ((progress.total - progress.pending) / progress.total) * 100 : 100}%` }}
                />
              </div>
              <div className="flex items-center gap-2">
                {done ? <CheckCircle2 className="size-5 text-[#008069]" /> : <Loader2 className="size-5 animate-spin text-[#00a884]" />}
                <span>
                  {progress.sent} enviados · {progress.skipped} sin enviar · {progress.failed} fallaron
                  {!done && ` · faltan ${progress.pending}`}
                </span>
              </div>
              {done && (
                <p className="text-xs text-[#54656f]">
                  Cada mensaje quedó en el chat de esa persona (WhatsApp → Chats), con sus ✓✓ de entregado y leído.
                </p>
              )}
              {done && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-full bg-[#00a884] px-4 font-medium text-white">
                    Listo
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </CrmModal>
    </>
  );
};

export default WhatsAppBulkSend;
