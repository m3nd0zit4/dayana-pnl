"use client";

import { ArrowLeft, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CHAT_CATEGORY_LABEL, isChatCategory, isSilencingCategory } from "@/lib/crm/chat-category-rules";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import { CATEGORY_SOURCE_LABEL, RunStatus, agoLabel } from "../status";
import { wa } from "./chatTheme";
import { ActionButton } from "./ui";

/** Qué es este chat (cliente, interesada, personal…), de dónde salió y si calla a la IA. */
const ClassificationInfo = ({ classification: c }: { classification: ChatDetail["classification"] }) => {
  const label = c.category && isChatCategory(c.category) ? CHAT_CATEGORY_LABEL[c.category] : null;
  const source = c.source ? (CATEGORY_SOURCE_LABEL[c.source] ?? c.source) : null;
  const confidence = c.source === "ai" && c.confidence != null ? ` · ${Math.round(c.confidence * 100)} %` : "";
  // Callaría, pero la etiqueta de la IA quedó vieja (la persona escribió después).
  const wouldSilence =
    c.stale &&
    isSilencingCategory(
      { category: c.category, categorySource: c.source, categoryConfidence: c.confidence, categoryReview: c.review },
      { enabled: c.enabled }
    );
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold text-(--wa-accent)">Categoría</h3>
      {label ? (
        <>
          <p>
            <span className="font-medium">{label}</span>
            {source && (
              <span className="text-(--wa-icon)">
                {" "}
                · {source}
                {confidence}
              </span>
            )}
            {c.review && <span className="text-(--wa-attention)"> · por revisar</span>}
          </p>
          {c.reason && <p className="text-xs text-(--wa-icon)">{c.reason}</p>}
          <p className="text-xs text-(--wa-meta)">
            {c.silencing
              ? "La IA no le contesta y no aparece en «Te toca» (salvo un pago, una urgencia o algo por aprobar)."
              : !c.enabled
                ? "La clasificación está apagada: la categoría solo informa."
                : wouldSilence
                  ? "Escribió después de que la IA lo mirara: lo vuelve a mirar antes de contestar."
                  : "Esta categoría no silencia a la IA."}
          </p>
        </>
      ) : (
        <p className="text-xs text-(--wa-meta)">Sin clasificar todavía. Cámbiala desde «⋯» si hace falta.</p>
      )}
    </section>
  );
};

/** Panel de la derecha: lo que la IA recuerda, la categoría, citas, enlaces de pago y lo que hizo. */
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
      {/* El nombre de lo que se abrió desde «⋯ → Lo que sabe la IA» (en el
          teléfono es una pantalla entera: sin título no se sabe dónde se está). */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onClose}
          aria-label="Volver al chat"
          title="Volver al chat"
          className={cn(wa.iconButton, "-ml-2 md:hidden")}
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-(--wa-text)">Lo que sabe la IA</h2>
          <p className="truncate text-xs text-(--wa-meta)">{chat.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          title="Cerrar"
          className={cn(wa.iconButton, "-mr-2 hidden md:grid")}
        >
          <X className="size-5" />
        </button>
      </div>
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

      <ClassificationInfo classification={chat.classification} />

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
