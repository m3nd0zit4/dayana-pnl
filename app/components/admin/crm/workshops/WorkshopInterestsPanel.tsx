"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { useCrm } from "../CrmProvider";
import { CrmDataList, CrmDataListRow, CrmEmptyState } from "../ui";

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
};

const STATUS_LABEL: Record<InterestStatus, string> = {
  nuevo: "Nuevo",
  contactada: "Contactada",
  inscrita: "Inscrita",
  descartada: "No le interesa",
};

/** «573123683443» → «+57 312 368 3443»; un id de usuario de WhatsApp («PE.1336…») no es un número. */
const phoneLabel = (thread: string) => (/^\d{8,15}$/.test(thread) ? `+${thread}` : "Usuario de WhatsApp");

/**
 * «Preguntaron por el taller»: quien escribió por WhatsApp preguntando por esta
 * edición (dueña, 24-oct), para el seguimiento. La fila lleva al chat; el
 * seguimiento se marca a la derecha.
 */
const WorkshopInterestsPanel = ({ slug, rows, timeZone }: { slug: string; rows: InterestRowView[]; timeZone: string }) => {
  const { toast } = useCrm();
  const [status, setStatus] = useState<Record<string, InterestStatus>>(() => Object.fromEntries(rows.map((r) => [r.id, r.status])));
  const when = (iso: string) =>
    new Date(iso).toLocaleString("es-CO", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const save = async (id: string, next: InterestStatus) => {
    const before = status[id];
    setStatus((s) => ({ ...s, [id]: next }));
    const res = await fetch(`/api/admin/workshops/${encodeURIComponent(slug)}/interests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setStatus((s) => ({ ...s, [id]: before }));
      toast("No se pudo guardar el seguimiento.", "error");
      return;
    }
    toast(`Seguimiento: ${STATUS_LABEL[next]}`);
  };

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-medium">Preguntaron por el taller ({rows.length.toLocaleString("es-CO")})</h2>
        <p className="text-xs text-muted-foreground">
          Escribieron por WhatsApp preguntando por este taller. La IA les ofrece la llamada con Dayana para inscribirse.
        </p>
      </div>
      {rows.length === 0 ? (
        <CrmEmptyState
          icon={MessageCircle}
          title="Nadie ha preguntado todavía"
          description="Cuando alguien pregunte por este taller por WhatsApp, aparece aquí."
        />
      ) : (
        <CrmDataList>
          {rows.map((r) => (
            <CrmDataListRow
              key={r.id}
              actions={
                <Select
                  value={status[r.id]}
                  onValueChange={(value) => {
                    if (typeof value === "string" && value !== status[r.id]) void save(r.id, value as InterestStatus);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={`Seguimiento de ${r.name ?? phoneLabel(r.phone)}`} className="w-40">
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
              }
            >
              <div className="min-w-0 flex-1">
                <Link href={`/admin/whatsapp?conversation=${r.conversationId}`} className="font-medium text-foreground hover:underline">
                  {r.name ?? phoneLabel(r.phone)}
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
                </p>
              </div>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}
    </section>
  );
};

export default WorkshopInterestsPanel;
