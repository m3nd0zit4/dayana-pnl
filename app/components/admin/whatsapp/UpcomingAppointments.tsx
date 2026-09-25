"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, Loader2, MessageCircle, RefreshCw, TriangleAlert, UserSearch } from "lucide-react";

import { useCrm } from "../crm/CrmProvider";

type Candidate = { name: string; phone: string; contactId: string | null };
type Item = {
  id: string;
  startsAt: string;
  title: string;
  name: string | null;
  phone: string | null;
  sessionsLabel: string | null;
  conversationId: string | null;
  matchState: string;
  candidates: Candidate[] | null;
  confirmedAt: string | null;
  reminderSentAt: string | null;
  reminderError: string | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Las citas del Google Calendar con su persona: número, sesiones, si se le
 * mandó el recordatorio y si confirmó. Arriba, las que falta saber quién es.
 */
const UpcomingAppointments = ({ canEdit }: { canEdit: boolean }) => {
  const { toast } = useCrm();
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/appointments", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setItems(((await res.json()) as { items: Item[] }).items);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const post = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/whatsapp/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "error");
      toast(ok, "success");
      await load();
    } catch (e) {
      toast(`No se pudo: ${e instanceof Error ? e.message : ""}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const pending = (items ?? []).filter((a) => a.matchState === "ambiguous" || a.matchState === "unmatched");
  const known = (items ?? []).filter((a) => a.matchState !== "ambiguous" && a.matchState !== "unmatched");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">Próximas citas</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => void post("sync", { action: "sync" }, "Calendario leído")}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Leer calendario ahora
          </button>
        )}
      </div>

      {items === null && <Loader2 className="size-5 animate-spin text-muted-foreground" />}

      {pending.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-200">
            <UserSearch className="size-4" /> Falta saber quién es ({pending.length}): sin número no hay recordatorio
          </p>
          <ul className="space-y-2">
            {pending.map((a) => (
              <li key={a.id} className="rounded-lg bg-white p-2.5 text-sm dark:bg-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.title || a.name || "Cita sin nombre"}</span>
                  <span className="text-xs text-muted-foreground">{when(a.startsAt)}</span>
                </div>
                {canEdit && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {(a.candidates ?? []).map((c) => (
                      <button
                        key={c.phone}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void post(a.id, { action: "assign", appointmentId: a.id, phone: `+${c.phone}` }, "Listo: número agregado a la cita")}
                        className="inline-flex h-8 items-center rounded-full border border-[#00a884] px-3 text-xs text-[#008069] hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-950/30"
                      >
                        {c.name} · +{c.phone}
                      </button>
                    ))}
                    <input
                      value={typed[a.id] ?? ""}
                      onChange={(e) => setTyped({ ...typed, [a.id]: e.target.value })}
                      placeholder="+57 300…"
                      inputMode="tel"
                      className="h-8 w-36 rounded-full border border-border bg-transparent px-3 text-base md:text-xs"
                    />
                    <button
                      type="button"
                      disabled={busy !== null || !(typed[a.id] ?? "").replace(/\D/g, "")}
                      onClick={() => void post(a.id, { action: "assign", appointmentId: a.id, phone: typed[a.id] }, "Listo: número agregado a la cita")}
                      className="inline-flex h-8 items-center rounded-full bg-[#00a884] px-3 text-xs font-medium text-white hover:bg-[#008069] disabled:opacity-50"
                    >
                      {busy === a.id ? <Loader2 className="size-3.5 animate-spin" /> : "Guardar"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {items && known.length === 0 && pending.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay citas en los próximos 14 días.</p>
      )}

      {known.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {known.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{when(a.startsAt)}</span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {a.name ?? a.title}
                {a.sessionsLabel && a.sessionsLabel !== "0/0" ? <span className="ml-1.5 text-xs text-muted-foreground">sesión {a.sessionsLabel}</span> : null}
                {a.sessionsLabel === "0/0" ? <span className="ml-1.5 text-xs text-muted-foreground">llamada gratis</span> : null}
              </span>
              {a.phone && <span className="text-xs text-muted-foreground">+{a.phone}</span>}
              <span className="inline-flex items-center gap-1 text-xs">
                {a.confirmedAt ? (
                  <span className="inline-flex items-center gap-1 text-[#008069]"><CheckCircle2 className="size-3.5" /> Confirmó</span>
                ) : a.reminderError ? (
                  <span className="inline-flex items-center gap-1 text-[#b42318]" title={a.reminderError}><TriangleAlert className="size-3.5" /> Recordatorio no salió</span>
                ) : a.reminderSentAt ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><BellRing className="size-3.5" /> Recordada</span>
                ) : (
                  <span className="text-muted-foreground">Recordatorio 24 h antes</span>
                )}
              </span>
              {a.conversationId && (
                <Link href={`/admin/whatsapp?conversation=${a.conversationId}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#008069] hover:underline">
                  <MessageCircle className="size-3.5" /> Chat
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default UpcomingAppointments;
