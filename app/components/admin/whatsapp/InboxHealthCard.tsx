"use client";

import { CheckCircle2, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { InboxHealth } from "@/lib/meta/inbox-health";
import { useCrm } from "../crm/CrmProvider";
import { useWhatsAppLive } from "./live";

const ago = (iso: string | null) => {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return min < 1 ? "hace un momento" : min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`;
};

/**
 * ¿Llega todo? La cola de entrada: lo pendiente, lo que se está reintentando
 * y lo que quedó sin poder guardarse. Con «Reprocesar» se vuelve a intentar ya.
 */
const InboxHealthCard = () => {
  const { toast } = useCrm();
  const [health, setHealth] = useState<InboxHealth | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/inbox", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setHealth((await res.json()) as InboxHealth);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useWhatsAppLive(load);

  const reprocess = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/whatsapp/inbox", { method: "POST" });
      const d = (await res.json()) as { stored: number; health: InboxHealth };
      if (!res.ok) throw new Error();
      setHealth(d.health);
      toast(d.stored ? `Listo: ${d.stored} mensajes guardados` : "Listo: no había nada pendiente", "success");
    } catch {
      toast("No se pudo reprocesar", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!health) return null;
  const trouble = health.failed + health.dead;
  const ok = trouble === 0 && health.pending === 0;

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {ok ? (
          <CheckCircle2 className="size-5 text-[#00a884]" aria-hidden />
        ) : (
          <TriangleAlert className="size-5 text-warning" aria-hidden />
        )}
        <h2 className="flex-1 text-sm font-semibold">
          {ok
            ? "Llega todo: ningún mensaje pendiente"
            : trouble > 0
              ? `${trouble} ${trouble === 1 ? "aviso" : "avisos"} de WhatsApp por reintentar`
              : `${health.pending} ${health.pending === 1 ? "mensaje" : "mensajes"} guardándose`}
        </h2>
        {trouble > 0 && (
          <button
            type="button"
            onClick={() => void reprocess()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#00a884] px-3 text-xs font-medium text-white hover:bg-[#008069] disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Reprocesar
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Último procesado {ago(health.lastProcessedAt)}
        {health.oldestPendingAt ? ` · el más antiguo en cola llegó ${ago(health.oldestPendingAt)}` : ""}
        {health.failed ? ` · ${health.failed} reintentándose solos` : ""}
        {health.dead ? ` · ${health.dead} necesitan revisión` : ""}
      </p>
      {health.deadSamples.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {health.deadSamples.map((d) => (
            <li key={d.id} className="truncate">
              {d.kind} · {ago(d.receivedAt)} · {d.lastError ?? "sin detalle"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default InboxHealthCard;
