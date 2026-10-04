"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarRange, Copy, Flag, Send, Users } from "lucide-react";
import { useCrm } from "../CrmProvider";
import { CrmPublicLink, CrmRowAction, CrmRowActions, CrmRowDelete } from "../ui";
import EditionsListShell, { type EditionRowView, type EditionsView } from "../editions/EditionsListShell";
import NewEditionModal, { type CopySource, type NewEditionValues } from "../editions/NewEditionModal";
import type { EditionStatus } from "../editions/status";
import { useEditionActions } from "../editions/useEditionActions";
import { WORKSHOP_ACTIONS } from "./actions-config";

/** Una fila de la lista, ya lista para cruzar al cliente. */
export type WorkshopListItem = {
  id: string;
  slug: string;
  title: string;
  status: EditionStatus;
  ended: boolean;
  dateLabel: string;
  scheduleLabel: string | null;
  publicPath: string;
  /** «$ 180.000 COP · US$45.00», o «Sin precio». */
  priceLine: string;
  hasCopPrice: boolean;
  legacyProduct: boolean;
  hasMeetingUrl: boolean;
  paid: number;
  stats: { email24h: number; email1h: number; wa24h: number; wa1h: number };
};

type Props = {
  workshops: WorkshopListItem[];
  initialView: EditionsView;
  operationalTimezone: string;
  copySources: CopySource[];
  /** Sin escritura (vista previa): ni crear ni acciones de fila. */
  readOnly?: boolean;
};

const n = (v: number) => (v > 0 ? v.toLocaleString("es-CO") : "—");

/**
 * Los talleres, igual que los eventos gratuitos: una edición por fila, con su
 * estado, su fecha, su precio, cuántas pagaron y cómo van los recordatorios.
 * Tocar la fila abre el taller (página, precio, inscritas, documentos,
 * WhatsApp e historia). Como mucho tres acciones por fila (contrato R6).
 */
const WorkshopsPageClient = ({ workshops, initialView, operationalTimezone, copySources, readOnly = false }: Props) => {
  const router = useRouter();
  const { canWrite, toast } = useCrm();
  const writable = canWrite && !readOnly;
  const actions = useEditionActions(WORKSHOP_ACTIONS);
  const [creating, setCreating] = useState(false);

  const open = workshops.find((w) => w.status === "OPEN" && !w.ended) ?? null;
  const openOther = open ? { id: open.id, title: open.title } : null;

  const RowActions = ({ w }: { w: WorkshopListItem }) => {
    if (!writable) return null;
    const target = { id: w.id, key: w.slug, title: w.title, registrations: w.paid };
    const busy = actions.busyId === w.id;
    const inscritas = (
      <CrmRowAction
        icon={Users}
        label="Inscritas"
        onClick={() => router.push(`/admin/workshops/${encodeURIComponent(w.slug)}?tab=inscritas`)}
      />
    );
    const terminar = (
      <CrmRowAction
        icon={Flag}
        label="Terminar (corta ventas y recordatorios)"
        disabled={busy}
        onClick={() => actions.end(target)}
      />
    );
    const duplicar = (
      <CrmRowAction icon={Copy} label="Duplicar" disabled={busy} onClick={() => actions.duplicate(target)} />
    );
    const eliminar = w.paid === 0 ? <CrmRowDelete disabled={busy} onClick={() => actions.remove(target)} /> : null;
    if (w.status === "OPEN" && !w.ended) {
      return (
        <CrmRowActions>
          <CrmPublicLink href={w.publicPath} label="Ver página pública" density="row" />
          {inscritas}
          {terminar}
        </CrmRowActions>
      );
    }
    if (w.status === "CLOSED" && !w.ended) {
      return (
        <CrmRowActions>
          <CrmRowAction
            icon={Send}
            label="Publicar otra vez (volver a vender)"
            disabled={busy}
            onClick={() => actions.publish(target, openOther)}
          />
          {inscritas}
          {terminar}
        </CrmRowActions>
      );
    }
    if (w.status === "DRAFT") {
      return (
        <CrmRowActions>
          <CrmRowAction icon={Send} label="Publicar" disabled={busy} onClick={() => actions.publish(target, openOther)} />
          {duplicar}
          {eliminar}
        </CrmRowActions>
      );
    }
    return (
      <CrmRowActions>
        {inscritas}
        {duplicar}
        {eliminar}
      </CrmRowActions>
    );
  };

  const toRow = (w: WorkshopListItem): EditionRowView => {
    const live = !w.ended && (w.status === "OPEN" || w.status === "CLOSED");
    const warnings = [
      live && !w.hasMeetingUrl ? "falta el enlace de la reunión" : null,
      !w.ended && w.status !== "COMPLETED" && !w.hasCopPrice && !w.legacyProduct ? "falta el precio en pesos" : null,
    ].filter(Boolean);
    return {
      id: w.id,
      href: `/admin/workshops/${encodeURIComponent(w.slug)}`,
      title: w.title,
      status: w.ended ? "COMPLETED" : w.status,
      actions: <RowActions w={w} />,
      details: (
        <>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {w.dateLabel}
            {w.scheduleLabel ? ` · ${w.scheduleLabel}` : ""}
          </span>
          <span className="mt-1 block text-xs">
            <strong className="font-semibold tabular-nums text-foreground">{w.paid.toLocaleString("es-CO")}</strong>{" "}
            <span className="text-muted-foreground">
              {w.paid === 1 ? "inscrita" : "inscritas"} · {w.priceLine}
              {w.legacyProduct ? " (heredado)" : ""}
            </span>
          </span>
          {w.paid > 0 && w.status !== "DRAFT" ? (
            // Dos líneas cortas, como en los eventos: correo y WhatsApp.
            <span className="mt-1 block space-y-0.5 text-[11px] leading-snug text-muted-foreground tabular-nums">
              <span className="block">
                <span className="font-medium text-foreground/80">Correo</span> · 24 h {n(w.stats.email24h)} · 1 h{" "}
                {n(w.stats.email1h)}
              </span>
              <span className="block">
                <span className="font-medium text-foreground/80">WhatsApp</span> · 24 h {n(w.stats.wa24h)} · 1 h{" "}
                {n(w.stats.wa1h)}
              </span>
            </span>
          ) : null}
          {warnings.length > 0 ? (
            <span className="mt-1 block text-[11px] text-warning">Ojo: {warnings.join(" y ")}.</span>
          ) : null}
        </>
      ),
    };
  };

  const upcoming = workshops.filter((w) => !w.ended);
  const past = workshops.filter((w) => w.ended);

  const create = async (v: NewEditionValues): Promise<string | null> => {
    const res = await fetch("/api/admin/workshops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: v.title || null,
        startsAtLocal: v.dateKey ? { date: v.dateKey, time: v.timeHm || null } : null,
        copyFromId: v.copyFromId,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { edition?: { slug: string }; message?: string };
    if (!res.ok || !data.edition) return data.message ?? "No se pudo crear el taller.";
    setCreating(false);
    toast("Borrador creado", "success");
    router.push(`/admin/workshops/${encodeURIComponent(data.edition.slug)}?tab=pagina`);
    return null;
  };

  return (
    <EditionsListShell
      title="Talleres"
      description={
        open ? (
          <>
            Publicado ahora: <strong className="font-medium text-foreground">«{open.title}»</strong>. Cada taller tiene
            su página, su precio, sus inscritas y su historia.
          </>
        ) : (
          "Ninguno publicado ahora. Cada taller tiene su página, su precio, sus inscritas y su historia."
        )
      }
      secondaryActions={<CrmPublicLink href="/taller-virtual" label="Ver página pública" copy />}
      newLabel={writable ? "Nuevo taller" : undefined}
      onNew={() => setCreating(true)}
      basePath="/admin/workshops"
      viewsAriaLabel="Qué talleres"
      initialView={initialView}
      upcoming={upcoming.map(toRow)}
      past={past.map(toRow)}
      icon={CalendarRange}
      empty={{
        upcoming: "No hay talleres próximos",
        upcomingDescription: writable
          ? "Crea uno con «Nuevo taller»: puedes copiar la página de uno anterior."
          : "Cuando prepares un taller aparecerá aquí.",
        past: "Todavía no hay talleres pasados",
        pastDescription: "Cuando un taller termine, quedará aquí con sus inscritas y su historia.",
      }}
    >
      <NewEditionModal
        open={creating}
        onClose={() => setCreating(false)}
        heading="Nuevo taller"
        titleDescription="Lo puedes cambiar después. Vacío = el de la página copiada."
        sources={copySources}
        defaultSourceId={copySources[0]?.id ?? null}
        copyHint="Textos, temas, cronograma y cupo. Nunca la fecha, el precio, las inscritas, los documentos ni el enlace de la reunión."
        operationalTimezone={operationalTimezone}
        onCreate={create}
      />
    </EditionsListShell>
  );
};

export default WorkshopsPageClient;
