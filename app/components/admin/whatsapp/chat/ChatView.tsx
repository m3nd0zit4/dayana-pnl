"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchMessages, stepMatch } from "@/lib/crm/whatsapp-chat-format";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import { useCrm } from "../../crm/CrmProvider";
import { useNow } from "../status";
import ChatHeader, { ChatSearchBar } from "./ChatHeader";
import Composer from "./Composer";
import InfoAside from "./InfoAside";
import Lightbox from "./Lightbox";
import MessageInfoDialog from "./MessageInfoDialog";
import MessageMenu from "./MessageMenu";
import MessageThread from "./MessageThread";
import { WINDOW_CLOSED_TEXT, messageDomId, post, type ChatMessage } from "./utils";

/**
 * Un chat abierto: cabecera, conversación, barra de escribir y el panel de lo
 * que sabe la IA. Aquí viven las acciones; las piezas solo pintan.
 */
const ChatView = ({
  chat,
  canWrite,
  onBack,
  onToggleSidebar,
  onChanged,
}: {
  chat: ChatDetail;
  canWrite: boolean;
  onBack: () => void;
  onToggleSidebar: () => void;
  onChanged: () => void;
}) => {
  const { toast } = useCrm();
  const [text, setText] = useState(chat.draft?.body ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(false);
  const now = useNow(true, 30_000);

  // «Cargar anteriores»: páginas de mensajes más viejos que los que trae el chat.
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const hasMore = olderHasMore ?? chat.hasMore;
  const allMessages = useMemo(() => {
    const seen = new Set(chat.messages.map((m) => m.id));
    return [...older.filter((m) => !seen.has(m.id)), ...chat.messages];
  }, [older, chat.messages]);
  const loadOlder = async () => {
    const first = allMessages[0];
    if (!first) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/chats/${chat.id}?before=${encodeURIComponent(first.sentAt)}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const page = (await res.json()) as { messages: ChatMessage[]; hasMore: boolean };
      setOlder((prev) => [...page.messages, ...prev]);
      setOlderHasMore(page.hasMore);
    } catch {
      toast("No se pudieron cargar los mensajes anteriores.", "error");
    } finally {
      setLoadingOlder(false);
    }
  };

  // Un borrador nuevo de la IA reemplaza el texto solo si Dayana no está
  // escribiendo otra cosa.
  const lastDraft = useRef(chat.draft?.body ?? "");
  useEffect(() => {
    const incoming = chat.draft?.body ?? "";
    if (incoming !== lastDraft.current) {
      setText((current) => (current.trim() === "" || current === lastDraft.current ? incoming : current));
      lastDraft.current = incoming;
    }
  }, [chat.draft?.body]);

  const errorText = (code: string) =>
    code === "window_closed"
      ? WINDOW_CLOSED_TEXT
      : code === "general_mode"
        ? "El modo general (Ajustes) está en Copiloto o Manual: ningún chat puede responder solo. Cámbialo allí si quieres la IA."
        : `No se pudo: ${code}`;

  const act = async (key: string, body: Record<string, unknown>, done?: string) => {
    setBusy(key);
    try {
      const data = await post(chat.id, body);
      if (done) toast(done, "success");
      onChanged();
      return data;
    } catch (e) {
      toast(errorText(e instanceof Error ? e.message : "error"), "error");
      return null;
    } finally {
      setBusy(null);
    }
  };

  // Responder citando un mensaje.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    stickToBottomRef.current = true;
    const ok = await act("send", {
      action: "send",
      body,
      ...(replyTo?.externalMessageId ? { replyTo: replyTo.externalMessageId } : {}),
    });
    if (ok) {
      setText("");
      setReplyTo(null);
      lastDraft.current = "";
    } else {
      stickToBottomRef.current = false;
    }
  };

  const suggest = async () => {
    const data = (await act("suggest", { action: "suggest" })) as
      | { draft: { action: string; message: string; reason: string } }
      | null;
    if (!data) return;
    if (data.draft.action === "reply") {
      setText(data.draft.message);
      lastDraft.current = data.draft.message;
    } else {
      toast(`La IA te lo dejaría a ti: ${data.draft.reason}`, "info");
    }
  };

  const slots = async () => {
    const data = (await act("slots", { action: "slots" })) as { text: string } | null;
    if (!data) return;
    if (!data.text) toast("No hay horas libres en tu horario de citas.", "info");
    else setText((t) => (t.trim() ? `${t}\n\n${data.text}` : data.text));
  };

  const resentIds = useMemo(
    () =>
      new Set(
        chat.messages
          .filter((m) => m.source?.startsWith("resend:") && m.status !== "FAILED")
          .map((m) => m.source!.slice("resend:".length))
      ),
    [chat.messages]
  );

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /** Quita del chat un mensaje que no llegó (la persona nunca lo vio). */
  const removeFailed = async (messageId: string) => {
    setBusy(`delete:${messageId}`);
    try {
      await post(chat.id, { action: "delete_failed", messageId });
      toast("Mensaje eliminado del chat", "success");
    } catch (e) {
      toast(`No se pudo eliminar: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally {
      setConfirmDelete(null);
      setBusy(null);
      onChanged();
    }
  };

  /** Reenvía un mensaje que WhatsApp no entregó; si no se puede desde el CRM, abre WhatsApp. */
  const resend = async (messageId: string) => {
    setBusy(`resend:${messageId}`);
    stickToBottomRef.current = true;
    try {
      const data = (await post(chat.id, { action: "resend", messageId })) as {
        status: "sent" | "phone";
        url?: string | null;
        reason?: string;
        mode?: string;
      };
      if (data.status === "sent") {
        toast(data.mode === "template" ? "Reenviado con plantilla" : "Reenviado", "success");
      } else {
        toast(data.reason ?? "Aún no se puede reenviar desde aquí.", "info");
      }
    } catch (e) {
      toast(`No se pudo reenviar: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const decide = async (
    runId: string,
    decision: "approve" | "reject" | "phone",
    message?: string,
    slots?: { startIso: string; label: string }[]
  ) => {
    try {
      await post(
        chat.id,
        decision === "approve"
          ? { action: "approve", runId, message, slots }
          : decision === "phone"
            ? { action: "approve_phone", runId, message }
            : { action: "reject", runId }
      );
      toast(decision === "approve" ? "Enviado" : decision === "phone" ? "Listo" : "Propuesta cancelada", "success");
      onChanged();
    } catch (e) {
      const code = e instanceof Error ? e.message : "error";
      toast(
        code === "window_closed" || code === "needs_phone"
          ? "Aún no se le puede escribir: falta que Meta apruebe la plantilla (WhatsApp → Plantillas)."
          : code.startsWith("slot:")
            ? `${code.slice(5)} Pídele a la IA otras horas o agenda tú.`
            : `No se pudo: ${code}`,
        "error"
      );
    }
  };

  /** Sube un archivo (foto, documento, nota de voz) y lo manda en este chat. */
  const sendFile = async (file: File, caption?: string) => {
    setBusy("file");
    stickToBottomRef.current = true;
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/inbox/upload", { method: "POST", body: form });
      const up = (await res.json().catch(() => ({}))) as {
        url?: string;
        mimeType?: string;
        filename?: string;
        error?: string;
      };
      if (!res.ok || !up.url) {
        toast(
          up.error === "unsupported_type"
            ? "Ese tipo de archivo no se puede mandar por WhatsApp."
            : up.error === "file_too_large"
              ? "El archivo es muy pesado para WhatsApp."
              : "No se pudo subir el archivo.",
          "error"
        );
        return;
      }
      await post(chat.id, {
        action: "attachment",
        url: up.url,
        mimeType: up.mimeType,
        filename: up.filename,
        body: caption,
      });
      onChanged();
    } catch (e) {
      const code = e instanceof Error ? e.message : "error";
      toast(code === "window_closed" ? "Pasaron más de 24 h desde su último mensaje." : `No se pudo enviar: ${code}`, "error");
    } finally {
      setBusy(null);
    }
  };

  // Menú del mensaje, info, foto en grande.
  const [menu, setMenu] = useState<{ message: ChatMessage; anchor: DOMRect } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [infoFor, setInfoFor] = useState<ChatMessage | null>(null);
  const closeInfo = useCallback(() => setInfoFor(null), []);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  // Saltar a un mensaje (la cita) y marcarlo un momento.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpTo = (messageId: string) => {
    document.getElementById(messageDomId(messageId))?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(messageId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1600);
  };
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // Buscar en el chat (entre los mensajes cargados).
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const matches = useMemo(() => (searchOpen ? searchMessages(allMessages, query) : []), [searchOpen, allMessages, query]);
  const current = matchIndex >= 0 && matchIndex < matches.length ? matchIndex : matches.length ? matches.length - 1 : -1;
  const currentMatchId = current >= 0 ? matches[current] : null;
  useEffect(() => {
    if (currentMatchId) document.getElementById(messageDomId(currentMatchId))?.scrollIntoView({ block: "center" });
  }, [currentMatchId]);
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setMatchIndex(-1);
  };

  const myReaction = (m: ChatMessage) => m.reactions.find((r) => r.actor === "business")?.emoji ?? null;

  const react = async (m: ChatMessage, emoji: string) => {
    closeMenu();
    await act("react", { action: "react", messageId: m.id, emoji });
  };

  const copy = async (m: ChatMessage) => {
    closeMenu();
    try {
      await navigator.clipboard.writeText(m.body ?? "");
      toast("Texto copiado", "success");
    } catch {
      toast("No se pudo copiar el texto.", "error");
    }
  };

  const startReply = (m: ChatMessage) => {
    closeMenu();
    setReplyTo(m);
    requestAnimationFrame(() => textarea.current?.focus());
  };

  const reactDisabledReason = (m: ChatMessage): string | null =>
    !canWrite
      ? "Solo lectura."
      : !m.externalMessageId
        ? "Este mensaje no tiene id de WhatsApp: no se le puede reaccionar."
        : !chat.windowOpen
          ? "Pasaron más de 24 h desde su último mensaje: WhatsApp no deja reaccionar."
          : busy !== null
            ? "Espera a que termine lo anterior."
            : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        chat={chat}
        canWrite={canWrite}
        busy={busy}
        act={act}
        onBack={onBack}
        onToggleSidebar={onToggleSidebar}
        showInfo={showInfo}
        onToggleInfo={() => setShowInfo((v) => !v)}
        searchOpen={searchOpen}
        onToggleSearch={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
      />
      {searchOpen && (
        <ChatSearchBar
          query={query}
          onQuery={(q) => {
            setQuery(q);
            setMatchIndex(-1);
          }}
          current={current}
          total={matches.length}
          onStep={(dir) => setMatchIndex(stepMatch(current, matches.length, dir))}
          onClose={closeSearch}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MessageThread
            messages={allMessages}
            chatName={chat.name}
            now={now}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onLoadOlder={() => void loadOlder()}
            query={searchOpen ? query : ""}
            currentMatchId={currentMatchId}
            flashId={flashId}
            resentIds={resentIds}
            confirmDeleteId={confirmDelete}
            stickToBottomRef={stickToBottomRef}
            onScrolled={closeMenu}
            canWrite={canWrite}
            busy={busy}
            onOpenMenu={(message, anchor) => setMenu({ message, anchor })}
            onOpenImage={setLightbox}
            onResend={(id) => void resend(id)}
            onDelete={(id) => (confirmDelete === id ? void removeFailed(id) : setConfirmDelete(id))}
            onCancelDelete={(id) => setConfirmDelete((c) => (c === id ? null : c))}
            onJumpTo={jumpTo}
          />
          <Composer
            ref={textarea}
            chat={chat}
            canWrite={canWrite}
            busy={busy}
            text={text}
            onText={setText}
            onSend={() => void send()}
            onSuggest={() => void suggest()}
            onSlots={() => void slots()}
            onSendFile={sendFile}
            onSticker={(url) => void act("sticker", { action: "sticker", url })}
            onDecide={decide}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </div>

        {showInfo && (
          <InfoAside
            chat={chat}
            canWrite={canWrite}
            busy={busy}
            now={now}
            onClose={() => setShowInfo(false)}
            onSaveMemory={(notes) => void act("memory", { action: "memory", notes }, "Guardado")}
          />
        )}
      </div>

      {menu && (
        <MessageMenu
          message={menu.message}
          anchor={menu.anchor}
          reactions={{ disabledReason: reactDisabledReason(menu.message), mine: myReaction(menu.message) }}
          canReply={canWrite && Boolean(menu.message.externalMessageId) && !menu.message.revokedAt}
          onReact={(emoji) => void react(menu.message, emoji)}
          onReply={() => startReply(menu.message)}
          onCopy={menu.message.body && !menu.message.revokedAt ? () => void copy(menu.message) : null}
          onInfo={
            menu.message.direction === "OUTBOUND"
              ? () => {
                  setInfoFor(menu.message);
                  closeMenu();
                }
              : null
          }
          onClose={closeMenu}
        />
      )}
      {infoFor && <MessageInfoDialog message={infoFor} onClose={closeInfo} />}
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closeLightbox} />}
    </div>
  );
};

export default ChatView;
