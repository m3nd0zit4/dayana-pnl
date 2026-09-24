"use client";

import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import { RunStatus, agoLabel } from "../status";
import { wa } from "./chatTheme";
import { ActionButton } from "./ui";

/** Panel de la derecha: lo que la IA recuerda, citas, enlaces de pago y lo que hizo. */
const InfoAside = ({
  chat,
  canWrite,
  busy,
  now,
  onClose,
  onSaveMemory,
}: {
  chat: ChatDetail;
  canWrite: boolean;
  busy: string | null;
  now: number;
  onClose: () => void;
  onSaveMemory: (notes: string) => void;
}) => {
  // El panel se monta de nuevo en cada chat (la vista lleva `key`), así que el
  // texto parte siempre de la memoria de ESE chat; si la IA la reescribe
  // mientras está abierto, se trae lo nuevo.
  const notes = chat.memory?.notes ?? "";
  const [memory, setMemory] = useState(notes);
  const [prevNotes, setPrevNotes] = useState(notes);
  if (notes !== prevNotes) {
    setPrevNotes(notes);
    setMemory(notes);
  }
  const links = chat.runs.flatMap((r) =>
    Array.isArray(r.toolCalls)
      ? (r.toolCalls as { tool: string; output?: { url?: string; product?: string } }[])
          .filter((t) => t.tool === "payment_link" && t.output?.url)
          .map((t) => ({ url: t.output!.url!, product: t.output?.product ?? "Paquetes" }))
      : []
  );

  return (
    <aside className="fixed inset-0 z-40 w-full shrink-0 space-y-5 overflow-y-auto bg-(--wa-surface) p-4 text-sm text-(--wa-text) md:static md:z-auto md:w-80 md:border-l md:border-(--wa-border)">
      <button
        type="button"
        onClick={onClose}
        className="flex h-10 items-center gap-2 text-sm font-medium text-(--wa-accent) md:hidden"
      >
        <ArrowLeft className="size-4" /> Volver al chat
      </button>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-(--wa-accent)">Lo que la IA recuerda</h3>
        <textarea
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          rows={7}
          placeholder="Aún nada. La IA la escribe al conversar; también puedes escribirla tú."
          disabled={!canWrite}
          className="w-full rounded-lg border border-(--wa-border) bg-(--wa-input) p-2 text-base text-(--wa-text) outline-none focus:border-(--wa-green) md:text-sm"
        />
        <ActionButton
          tone="primary"
          disabled={!canWrite || memory === (chat.memory?.notes ?? "") || busy !== null}
          onClick={() => onSaveMemory(memory)}
        >
          Guardar
        </ActionButton>
      </section>

      {chat.bookings.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-(--wa-accent)">Citas que agendó la IA</h3>
          {chat.bookings.map((b) => (
            <div key={b.id} className="rounded-lg border border-(--wa-divider) p-2.5">
              <div className="font-medium">{b.service}</div>
              <div className="text-(--wa-icon) capitalize">
                {new Date(b.startsAt).toLocaleString("es-CO", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {b.meetUrl && (
                  <a href={b.meetUrl} target="_blank" rel="noreferrer" className={cn("rounded-full px-3 py-2 text-xs font-medium", wa.primary)}>
                    🎥 Abrir Meet
                  </a>
                )}
                {b.eventUrl && (
                  <a href={b.eventUrl} target="_blank" rel="noreferrer" className={cn("rounded-full px-3 py-2 text-xs font-medium", wa.outline)}>
                    📅 Ver en el calendario
                  </a>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {links.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-(--wa-accent)">Enlaces de pago enviados</h3>
          {links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-(--wa-divider) px-2.5 py-2 text-sm hover:bg-(--wa-hover)"
            >
              <span className="truncate">{l.product}</span>
              <span className="shrink-0 text-xs font-medium text-(--wa-accent)">💳 Abrir</span>
            </a>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-(--wa-accent)">Lo que hizo la IA aquí</h3>
        {chat.runs.length === 0 && <p className="text-(--wa-meta)">Nada todavía.</p>}
        {chat.runs.slice(0, 8).map((r) => {
          const tools = Array.isArray(r.toolCalls) ? (r.toolCalls as { tool: string }[]).map((t) => t.tool) : [];
          return (
            <div key={r.id} className="space-y-0.5 border-b border-(--wa-divider) pb-2">
              <RunStatus run={r} />
              <div className="text-xs text-(--wa-meta)">
                {agoLabel(r.queuedAt, now)}
                {tools.length > 0 && ` · usó: ${[...new Set(tools)].join(", ")}`}
              </div>
              {r.reason && r.status !== "SKIPPED" && <div className="text-xs text-(--wa-icon)">{r.reason}</div>}
            </div>
          );
        })}
      </section>
    </aside>
  );
};

export default InfoAside;
