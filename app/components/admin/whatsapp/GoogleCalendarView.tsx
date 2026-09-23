"use client";

import { Bot, CalendarCheck, ExternalLink, Loader2, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type CalendarEvent = {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  availability: boolean;
  free: boolean;
  meetUrl: string | null;
  link: string | null;
  aiConversationId: string | null;
};

const dayKey = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" }) : "";

/**
 * La agenda de verdad: el Google Calendar de Dayana, día por día. Lo que la IA
 * agendó aparece marcado, y los bloques «Disponible» en verde: son las horas
 * que la IA puede ofrecer.
 */
const GoogleCalendarView = () => {
  const [data, setData] = useState<{ account: string | null; events: CalendarEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/whatsapp/calendar?days=14", { cache: "no-store" }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as
        | { account: string | null; events: CalendarEvent[]; error?: string }
        | null;
      if (!res?.ok || !body) setError(body?.error ?? "No se pudo leer el calendario.");
      else setData(body);
    })();
  }, []);

  if (error) {
    return (
      <p className="rounded-lg border border-[#e9edef] bg-white p-3 text-sm text-[#54656f]">
        No se pudo leer tu Google Calendar: {error}{" "}
        <Link href="/admin/ajustes/google" className="font-medium text-[#008069] hover:underline">
          Revisar conexión
        </Link>
      </p>
    );
  }
  if (!data) return <Loader2 className="size-5 animate-spin text-[#00a884]" />;

  const groups = new Map<string, CalendarEvent[]>();
  for (const e of data.events) {
    if (!e.start) continue;
    const key = dayKey(e.start);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Tu Google Calendar · próximos 14 días</h2>
        {data.account && <span className="text-xs text-[#667781]">{data.account}</span>}
      </div>
      <p className="text-xs text-[#667781]">
        La IA solo ofrece horas libres de aquí. Para decidir cuándo atiendes, crea en tu calendario eventos
        llamados <strong>«Disponible»</strong> en esos horarios: la IA agenda solo dentro de ellos.
      </p>
      {groups.size === 0 && <p className="text-sm text-[#667781]">No hay nada en tu calendario estos días.</p>}
      <div className="space-y-3">
        {[...groups.entries()].map(([day, events]) => (
          <div key={day} className="rounded-xl border border-[#e9edef] bg-white dark:border-border dark:bg-card">
            <div className="border-b border-[#e9edef] px-3 py-1.5 text-sm font-medium capitalize text-[#111b21] dark:border-border dark:text-foreground">
              {day}
            </div>
            <ul className="divide-y divide-[#f0f2f5] dark:divide-border">
              {events.map((e) => (
                <li
                  key={e.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2 px-3 py-2 text-sm",
                    e.availability && "bg-[#f0faf5] dark:bg-emerald-950/20"
                  )}
                >
                  <span className="w-32 shrink-0 text-[#54656f]">
                    {e.allDay ? "Todo el día" : `${hm(e.start)} – ${hm(e.end)}`}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", e.availability && "font-medium text-[#008069]")}>
                    {e.availability && <CalendarCheck className="mr-1 inline size-4" />}
                    {e.summary}
                    {e.free && !e.availability && <span className="ml-1 text-xs text-[#667781]">(libre)</span>}
                  </span>
                  {e.aiConversationId && (
                    <Link
                      href={`/admin/whatsapp?conversation=${e.aiConversationId}`}
                      className="inline-flex items-center gap-1 rounded-full bg-[#d9fdd3] px-2 py-0.5 text-xs font-medium text-[#008069]"
                    >
                      <Bot className="size-3.5" /> Agendó la IA
                    </Link>
                  )}
                  {e.meetUrl && (
                    <a href={e.meetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[#00a884] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#008069]">
                      <Video className="size-3.5" /> Meet
                    </a>
                  )}
                  {e.link && (
                    <a href={e.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[#d1d7db] px-2.5 py-1 text-xs font-medium text-[#111b21] hover:bg-[#f5f6f6] dark:border-border dark:text-foreground">
                      <ExternalLink className="size-3.5" /> Calendario
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
};

export default GoogleCalendarView;
