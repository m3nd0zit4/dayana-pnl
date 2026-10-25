"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarPlus, HandHeart, PhoneCall } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { useCrm } from "../CrmProvider";
import { CrmDataList, CrmDataListRow, CrmEmptyState, CrmRowAction, CrmRowActions } from "../ui";

export type InterestStatus = "nuevo" | "contactada" | "inscrita" | "descartada";

export type InterestRowView = {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string;
  firstMessage: string;
  lastAskedAtIso: string;
  asks: number;
  status: InterestStatus;
  nextCallAtIso: string | null;
  paid: boolean;
  /** Cuándo la IA le ofreció la llamada desde aquí, y cómo. */
  offeredAtIso: string | null;
  offeredVia: "text" | "template" | null;
  /** Escribió en las últimas 24 h: la IA le manda horas; si no, va la plantilla. */
  windowOpen: boolean;
};

const STATUS_LABEL: Record<InterestStatus, string> = {
  nuevo: "Nuevo",
  contactada: "Contactada",
  inscrita: "Inscrita",
  descartada: "No le interesa",
};

/** «573123683443» → «+57 312 368 3443»; un id de usuario de WhatsApp («PE.1336…») no es un número. */
const isPhone = (thread: string) => /^\d{8,15}$/.test(thread);
const phoneLabel = (thread: string) => (isPhone(thread) ? `+${thread}` : "Usuario de WhatsApp");

/** Por qué la IA no le escribiría desde la API (`offerWorkshopCall`). */
const SKIP_MESSAGE: Record<string, string> = {
  closed: "El taller ya no está abierto.",
  paid: "Ya pagó el taller.",
  has_call: "Ya tiene una llamada agendada con Dayana.",
  already: "La IA ya le escribió hoy.",
  needs_template: "Pasaron más de 24 h y falta la plantilla aprobada.",
};

/**
 * «Interesadas»: el registro de interés del taller (dueña, 24-oct). Quien
 * preguntó por WhatsApp por esta edición; no es una inscripción (no pagó, no
 * tiene acceso). Dayana las llama ella misma o toca «Que la IA le ofrezca la
 * llamada» y la IA le escribe con horas para la llamada de inscripción. La fila
 * lleva al chat; el seguimiento se marca a la derecha.
 */
const WorkshopInterestsPanel = ({
  slug,
  rows: initialRows,
  timeZone,
  open,
}: {
  slug: string;
  rows: InterestRowView[];
  timeZone: string;
  /** El taller tiene inscripciones abiertas: solo entonces la IA les escribe. */
  open: boolean;
}) => {
  const { toast, confirm } = useCrm();
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("es-CO", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const nameOf = (r: InterestRowView) => r.name ?? phoneLabel(r.phone);
  const patch = (id: string, next: Partial<InterestRowView>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...next } : r)));

  const save = async (r: InterestRowView, next: InterestStatus) => {
    const before = r.status;
    patch(r.id, { status: next });
    const res = await fetch(`/api/admin/workshops/${encodeURIComponent(slug)}/interests/${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    if (!res?.ok) {
      patch(r.id, { status: before });
      toast("No se pudo guardar el seguimiento.", "error");
      return;
    }
    toast(`Seguimiento: ${STATUS_LABEL[next]}`);
  };

  const offer = async (r: InterestRowView) => {
    setBusy(r.id);
    const res = await fetch(`/api/admin/workshops/${encodeURIComponent(slug)}/interests/${encodeURIComponent(r.id)}/offer`, {
      method: "POST",
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | { ok: true; via: "text" | "template"; slots: number; offeredAt: string }
      | { ok: false; reason: string; detail: string | null }
      | null;
    setBusy(null);
    if (!data) {
      toast("No se pudo escribirle. Inténtalo de nuevo.", "error");
      return;
    }
    if (!data.ok) {
      toast(data.detail && data.reason !== "failed" ? data.detail : (SKIP_MESSAGE[data.reason] ?? "El mensaje no salió. Revisa el chat."), "error");
      return;
    }
    // Del estado actual de la fila (pudo cambiar el seguimiento mientras salía), como lo hace el servidor.
    setRows((all) =>
      all.map((x) =>
        x.id === r.id ? { ...x, offeredAtIso: data.offeredAt, offeredVia: data.via, status: x.status === "nuevo" ? "contactada" : x.status } : x
      )
    );
    toast(
      data.via === "text"
        ? data.slots > 0
          ? `La IA le mandó ${data.slots} horas a ${nameOf(r)}.`
          : `La IA le escribió a ${nameOf(r)}.`
        : `La IA le escribió a ${nameOf(r)} con la plantilla.`
    );
  };

  const askOffer = (r: InterestRowView) =>
    confirm({
      title: `¿Le escribe la IA a ${nameOf(r)}?`,
      message: r.windowOpen
        ? "Le cuenta del taller y le manda horas libres para la llamada con Dayana. Si elige una, queda agendada."
        : "Pasaron más de 24 h desde su último mensaje: va con la plantilla «Retomar la conversación» (Meta la cobra) y le pregunta si quiere separar la llamada.",
      confirmLabel: "Escribirle",
      onConfirm: () => offer(r),
    });

  /** Por qué no se le puede ofrecer; null = sí. */
  const cannotOffer = (r: InterestRowView): string | null =>
    !open ? SKIP_MESSAGE.closed : r.paid ? SKIP_MESSAGE.paid : r.nextCallAtIso ? SKIP_MESSAGE.has_call : null;

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-medium">Interesadas ({rows.length.toLocaleString("es-CO")})</h2>
        <p className="text-xs text-muted-foreground">
          Registro de interés: preguntaron por este taller por WhatsApp. No es una inscripción: no han pagado y no tienen acceso.
          Llámalas tú o deja que la IA les ofrezca horas para la llamada con Dayana.
        </p>
      </div>
      {rows.length === 0 ? (
        <CrmEmptyState
          icon={HandHeart}
          title="Nadie ha preguntado todavía"
          description="Cuando alguien pregunte por este taller por WhatsApp, aparece aquí."
        />
      ) : (
        <CrmDataList>
          {rows.map((r) => {
            const blocked = cannotOffer(r);
            return (
              <CrmDataListRow
                key={r.id}
                actions={
                  <CrmRowActions>
                    {isPhone(r.phone) ? (
                      <CrmRowAction
                        icon={PhoneCall}
                        label={`Llamar a ${nameOf(r)} por WhatsApp`}
                        onClick={() => window.open(`https://wa.me/${r.phone}`, "_blank", "noopener,noreferrer")}
                      />
                    ) : null}
                    <CrmRowAction
                      icon={CalendarPlus}
                      label={blocked ?? (busy === r.id ? "Escribiéndole…" : `Que la IA le ofrezca la llamada a ${nameOf(r)}`)}
                      disabled={Boolean(blocked) || busy !== null}
                      onClick={() => askOffer(r)}
                    />
                  </CrmRowActions>
                }
              >
                <div className="min-w-0 flex-1 basis-64">
                  <Link href={`/admin/whatsapp?conversation=${r.conversationId}`} className="font-medium text-foreground hover:underline">
                    {nameOf(r)}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.name ? `${phoneLabel(r.phone)} · ` : ""}
                    preguntó {when(r.lastAskedAtIso)}
                    {r.asks > 1 ? ` · ${r.asks} veces` : ""}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm [overflow-wrap:anywhere]">«{r.firstMessage}»</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {r.paid ? <Badge variant="secondary">Pagó el taller</Badge> : null}
                    {r.nextCallAtIso ? (
                      <Badge variant="outline">Llamada: {when(r.nextCallAtIso)}</Badge>
                    ) : (
                      <Badge variant="outline">Sin llamada agendada</Badge>
                    )}
                    {r.offeredAtIso ? (
                      <Badge variant="outline">
                        {r.offeredVia === "template" ? "La IA le escribió" : "La IA le ofreció horas"} · {when(r.offeredAtIso)}
                      </Badge>
                    ) : null}
                  </p>
                </div>
                <Select
                  value={r.status}
                  onValueChange={(value) => {
                    if (typeof value === "string" && value !== r.status) void save(r, value as InterestStatus);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={`Seguimiento de ${nameOf(r)}`} className="w-40 shrink-0">
                    <SelectValue>{(value) => STATUS_LABEL[value as InterestStatus] ?? String(value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as InterestStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CrmDataListRow>
            );
          })}
        </CrmDataList>
      )}
    </section>
  );
};

export default WorkshopInterestsPanel;
