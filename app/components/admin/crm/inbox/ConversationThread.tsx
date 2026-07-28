"use client";

import { Send, Sparkles, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { useCrm } from "../CrmProvider";
import LinkContactDialog from "./LinkContactDialog";
import {
  CHANNEL_LABEL,
  STATUS_LABEL,
  humanizeInboxError,
  type ConversationDetailView,
  type ConversationMessageView,
  type InboxStatus,
  type StaffRef,
} from "./types";

type Props = {
  detail: ConversationDetailView;
  staff: StaffRef[];
  canWrite: boolean;
  busy: boolean;
  onRefresh: () => void;
};

/**
 * Hora absoluta, no relativa.
 *
 * "hace 5 min" depende de `Date.now()`, que en un componente que también se
 * renderiza en el servidor da un valor distinto a cada lado y desajusta la
 * hidratación. Una hora fija derivada solo del ISO es pura, estable y además no
 * necesita un temporizador para dejar de mentir.
 */
const TIME_FORMAT = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const MessageBubble = ({ message }: { message: ConversationMessageView }) => {
  const when = TIME_FORMAT.format(new Date(message.sentAt));
  const outbound = message.direction === "OUTBOUND";

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] space-y-1 rounded-lg px-3 py-2 text-sm ${
          outbound ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {message.attachments.map((attachment, i) =>
          attachment.url && attachment.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={attachment.url}
              alt={attachment.caption ?? "Adjunto"}
              className="max-h-64 rounded-md object-cover"
            />
          ) : (
            <p key={i} className="text-xs italic opacity-80">
              {attachment.url ? (
                <a href={attachment.url} target="_blank" rel="noreferrer" className="underline">
                  Adjunto ({attachment.kind})
                </a>
              ) : (
                `Adjunto no disponible (${attachment.unavailableReason ?? "desconocido"})`
              )}
            </p>
          )
        )}

        {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}

        <p className="flex items-center gap-2 text-[10px] opacity-70">
          <span>{when}</span>
          {message.staffUser && <span>· {message.staffUser.displayName}</span>}
          {message.isEcho && <span>· desde la app</span>}
        </p>

        {message.status === "FAILED" && (
          <p className="text-xs text-destructive">
            No se envió: {message.failedReason}
          </p>
        )}
      </div>
    </div>
  );
};

const ConversationThread = ({ detail, staff, canWrite, busy, onRefresh }: Props) => {
  const { toast, confirm } = useCrm();
  const [draft, setDraft] = useState(detail.draftBody ?? "");
  const [draftIsAgent, setDraftIsAgent] = useState(detail.draftSource === "AGENT");
  const [sending, setSending] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // El borrador se inicializa una vez por hilo: el padre monta este componente
  // con `key={detail.id}`, así que cambiar de conversación lo reinicia solo.
  // Sincronizarlo por efecto pisaría lo que el operador esté escribiendo cada
  // vez que llega un mensaje nuevo y el hilo se recarga.

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }, [detail.id, detail.messages.length]);

  /** Guarda el borrador sin bloquear al operador. */
  useEffect(() => {
    if (draft === (detail.draftBody ?? "")) return;
    const timer = setTimeout(() => {
      void fetch(`/api/admin/inbox/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft", draft: draft || null }),
      }).catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, detail.id, detail.draftBody]);

  const act = async (body: Record<string, unknown>, okMessage?: string) => {
    try {
      const res = await fetch(`/api/admin/inbox/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(humanizeInboxError(data.error), "error");
        return false;
      }
      if (okMessage) toast(okMessage);
      onRefresh();
      return true;
    } catch {
      toast("No se pudo completar la acción. Revisa tu conexión.", "error");
      return false;
    }
  };

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/inbox/${detail.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });

      if (res.status === 409) {
        // La ventana se cerró mientras escribía: se recarga para que el
        // compositor refleje la regla en vez de invitar al mismo fallo.
        toast(
          "La ventana de respuesta se cerró. Actualizamos la conversación.",
          "error"
        );
        onRefresh();
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(humanizeInboxError(data.error), "error");
        return;
      }

      setDraft("");
      setDraftIsAgent(false);
      onRefresh();
    } catch {
      toast("No se pudo enviar. Revisa tu conexión.", "error");
    } finally {
      setSending(false);
    }
  };

  const windowBlocked =
    detail.window.requirement === "closed" ||
    detail.window.requirement === "template";
  const composerDisabled = !canWrite || sending || windowBlocked;

  const title = useMemo(
    () =>
      detail.contact?.displayName ??
      detail.participantName ??
      detail.externalThreadId,
    [detail]
  );

  return (
    <div className="flex max-h-[70vh] flex-col rounded-lg border">
      <header className="flex flex-wrap items-center gap-2 border-b p-3">
        {detail.participantAvatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={detail.participantAvatarUrl}
            alt=""
            className="size-7 rounded-full border object-cover"
          />
        )}
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="outline">{CHANNEL_LABEL[detail.channel]}</Badge>
        <Badge variant="secondary">{STATUS_LABEL[detail.status]}</Badge>

        {!detail.contact && canWrite && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setLinkOpen(true)}
          >
            <UserPlus className="size-4" aria-hidden />
            Vincular contacto
          </Button>
        )}

        {canWrite && (
          <span className="ml-auto flex flex-wrap gap-1">
            <select
              aria-label="Asignar a"
              className="rounded-md border bg-background px-2 py-1 text-xs"
              value={detail.assignedStaff?.id ?? ""}
              onChange={(e) =>
                void act(
                  { action: "assign", assignedStaffId: e.target.value || null },
                  "Conversación asignada."
                )
              }
            >
              <option value="">Sin asignar</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>

            <select
              aria-label="Estado"
              className="rounded-md border bg-background px-2 py-1 text-xs"
              value={detail.status}
              onChange={(e) => {
                const status = e.target.value as InboxStatus;
                if (status === "CLOSED") {
                  confirm({
                    title: "Cerrar conversación",
                    message:
                      "Dejará de aparecer en la bandeja abierta. Puedes reabrirla luego.",
                    onConfirm: () =>
                      void act({ action: "status", status }, "Conversación cerrada."),
                  });
                  return;
                }
                void act({ action: "status", status });
              }}
            >
              {(["OPEN", "PENDING", "CLOSED"] as InboxStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </span>
        )}
      </header>

      <div
        role="log"
        aria-live="polite"
        aria-label="Mensajes"
        className="flex-1 space-y-3 overflow-y-auto p-4"
      >
        {detail.messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Todavía no hay mensajes en este hilo.
          </p>
        )}
        {detail.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={endRef} />
      </div>

      <footer className="space-y-2 border-t p-3">
        {detail.windowNotice && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {detail.windowNotice}
          </p>
        )}
        {draftIsAgent && draft === (detail.draftBody ?? "") && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="size-3" aria-hidden />
            Borrador propuesto por el asistente — revísalo antes de enviar.
          </p>
        )}

        <div className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // En cuanto el operador escribe deja de ser el borrador del
              // asistente; mantener el aviso sería atribuirle su texto.
              setDraftIsAgent(false);
            }}
            placeholder={
              windowBlocked
                ? "No se puede escribir en esta conversación ahora mismo."
                : "Escribe tu respuesta…"
            }
            disabled={composerDisabled}
            rows={2}
            className="resize-none"
            aria-label="Respuesta"
          />
          <Button
            onClick={() => void send()}
            disabled={composerDisabled || !draft.trim() || busy}
            aria-label="Enviar"
            title="Enviar"
          >
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
      </footer>

      {linkOpen && (
        <LinkContactDialog
          conversationId={detail.id}
          onClose={() => setLinkOpen(false)}
          onLinked={() => {
            setLinkOpen(false);
            onRefresh();
          }}
        />
      )}
    </div>
  );
};

export default ConversationThread;
