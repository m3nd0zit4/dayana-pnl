"use client";

import Link from "next/link";
import { AlertTriangle, Check, Loader2, PhoneCall, PhoneMissed, Smartphone, X } from "lucide-react";
import { useState } from "react";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { useCrm } from "../crm/CrmProvider";
import { ActionButton } from "./chat/ui";
import { wa } from "./chat/chatTheme";

type Reason = "needs_template" | "silenced" | "failed";

/** Por qué no salió el mensaje para reagendar, dicho para Dayana. */
const NOTICE: Record<Reason, string> = {
  needs_template:
    "Quedó como no contestada, pero no se le pudo escribir: su último mensaje fue hace más de 24 h y para eso WhatsApp pide la plantilla «Llamada gratis: no contestó», que aún no está aprobada. Apruébala en Plantillas o escríbele desde tu celular.",
  silenced:
    "Quedó como no contestada. No se le escribió: la asistente no escribe en este chat (modo manual, chat tomado por ti, clienta o número personal). Escríbele tú para reagendar.",
  failed: "Quedó como no contestada, pero el mensaje para reagendar no salió. Escríbele tú desde aquí o desde tu celular.",
};

/**
 * La llamada gratis ya pasó y no se sabe cómo terminó: WhatsApp no avisa de
 * las llamadas que Dayana hace desde el celular (coexistencia), pero ella sí
 * ve «Sin respuesta». Encima de la caja de escribir, como el comprobante:
 * «¿Cómo terminó la llamada gratis de hoy, 7:15 p. m.?» con «Hablaron» y «No
 * contestó». «No contestó» le manda horas libres para reagendar (quedan
 * ofrecidas: si elige una, la asistente la agenda).
 */
const CallOutcomeBar = ({
  chatId,
  call,
  phone,
  canWrite,
  onChanged,
}: {
  chatId: string;
  call: ChatDetail["callFollowUp"];
  /** Número del chat (solo dígitos), para «Escribirle desde el celular». */
  phone: string;
  canWrite: boolean;
  onChanged: () => void;
}) => {
  const { toast } = useCrm();
  const [busy, setBusy] = useState<"answered" | "no_answer" | null>(null);
  /** Lo que pasó al marcar «No contestó» si el mensaje no salió (queda hasta cerrarlo). */
  const [notice, setNotice] = useState<{ chatId: string; reason: Reason } | null>(null);
  const shownNotice = notice?.chatId === chatId ? notice : null;

  if (!call && !shownNotice) return null;

  const mark = async (appointmentId: string, outcome: "answered" | "no_answer") => {
    setBusy(outcome);
    const res = await fetch("/api/admin/whatsapp/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "outcome", appointmentId, outcome }),
    }).catch(() => null);
    const data = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string; sent?: boolean; reason?: Reason };
    setBusy(null);
    if (!res?.ok) {
      toast(data.error === "already_decided" ? "Esa llamada ya estaba marcada." : "No se pudo guardar. Intenta de nuevo.", "error");
      if (data.error === "already_decided") onChanged();
      return;
    }
    if (outcome === "answered") toast("Listo: quedó que hablaron.", "success");
    else if (data.sent) toast("Le mandamos horas para reagendar.", "success");
    else setNotice({ chatId, reason: data.reason ?? "failed" });
    onChanged();
  };

  const phoneUrl = /^\d{8,15}$/.test(phone) ? buildContactWhatsAppUrl(`+${phone}`) : null;

  return (
    <div className="space-y-2">
      {call && (
        <div className="rounded-xl border border-(--wa-border) bg-(--wa-surface) p-3 text-(--wa-text)">
          <div className="flex items-start gap-2">
            <PhoneCall className="mt-0.5 size-4 shrink-0 text-(--wa-accent)" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-sm font-semibold">¿Cómo terminó la llamada gratis {call.when}?</div>
              <div className="text-xs text-(--wa-meta)">
                {call.asked
                  ? "La asistente ya le preguntó «¿Pudiste hablar con Dayana?». Si ya sabes cómo terminó, márcalo aquí."
                  : "WhatsApp no avisa cómo terminan las llamadas del celular. Si no contestó, la asistente le manda horas libres para reagendar."}
              </div>
            </div>
          </div>
          {canWrite && (
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton disabled={busy !== null} onClick={() => void mark(call.appointmentId, "answered")}>
                {busy === "answered" ? <Loader2 className="animate-spin" /> : <Check className="text-(--wa-accent)" />} Hablaron
              </ActionButton>
              <ActionButton disabled={busy !== null} onClick={() => void mark(call.appointmentId, "no_answer")}>
                {busy === "no_answer" ? <Loader2 className="animate-spin" /> : <PhoneMissed className="text-(--wa-danger-ink)" />} No contestó
              </ActionButton>
            </div>
          )}
        </div>
      )}
      {shownNotice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-(--wa-attention) bg-(--wa-attention-soft) p-3 text-(--wa-text)">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-(--wa-attention)" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm">{NOTICE[shownNotice.reason]}</p>
            <div className="flex flex-wrap gap-2">
              {shownNotice.reason === "needs_template" && (
                <Link
                  href="/admin/whatsapp/plantillas"
                  className={`inline-flex min-h-9 items-center rounded-full px-3 text-xs font-medium ${wa.outline}`}
                >
                  Ir a Plantillas
                </Link>
              )}
              {phoneUrl && (
                <a
                  href={phoneUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${wa.outline}`}
                >
                  <Smartphone className="size-3.5" /> Escribirle desde el celular
                </a>
              )}
            </div>
          </div>
          <button type="button" onClick={() => setNotice(null)} className={wa.iconButton} aria-label="Cerrar el aviso" title="Cerrar el aviso">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default CallOutcomeBar;
