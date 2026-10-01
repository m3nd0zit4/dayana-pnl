"use client";

import { Copy, Flag, RotateCcw, Send, Square } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { useCrm } from "../CrmProvider";
import { CrmPublicLink } from "../ui";
import type { FreeEventStatusValue } from "./FreeEventsPageClient";
import { useFreeEventActions } from "./useFreeEventActions";

type Props = {
  event: {
    id: string;
    headline: string;
    status: FreeEventStatusValue;
    publicPath: string;
    registrations: number;
  };
  /** El que está publicado ahora, si es otro: se nombra al publicar este. */
  openOther: { id: string; headline: string } | null;
  editionsEnabled: boolean;
};

/**
 * Las acciones de la cabecera de un evento: verlo en la web, duplicarlo y el
 * paso que le toca según su estado (publicar, cerrar inscripciones, terminar,
 * reabrir). Ninguna crea nada, así que van como secundarias (contrato R2).
 */
const FreeEventDetailActions = ({ event, openOther, editionsEnabled }: Props) => {
  const { canWrite } = useCrm();
  const actions = useFreeEventActions();
  const busy = actions.busyId === event.id;
  const target = { id: event.id, headline: event.headline, registrations: event.registrations };

  return (
    <>
      <CrmPublicLink
        href={event.status === "OPEN" ? "/eventos-gratuitos" : event.publicPath}
        label="Ver en web"
        copy={event.status !== "DRAFT"}
        disabledReason={event.status === "DRAFT" ? "Es un borrador: aún no tiene página pública." : undefined}
      />
      {canWrite && editionsEnabled ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => actions.duplicate(target)}>
          <Copy aria-hidden />
          Duplicar
        </Button>
      ) : null}
      {canWrite && event.status === "OPEN" ? (
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => actions.unpublish(target)}>
            <Square aria-hidden />
            Cerrar inscripciones
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => actions.end(target)}>
            <Flag aria-hidden />
            Terminar
          </Button>
        </>
      ) : null}
      {canWrite && event.status === "CLOSED" ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => actions.end(target)}>
          <Flag aria-hidden />
          Terminar
        </Button>
      ) : null}
      {canWrite && event.status === "COMPLETED" ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => actions.reopen(target)}>
          <RotateCcw aria-hidden />
          Reabrir
        </Button>
      ) : null}
      {canWrite && (event.status === "DRAFT" || event.status === "CLOSED") ? (
        <Button type="button" size="sm" disabled={busy} onClick={() => actions.publish(target, openOther)}>
          <Send aria-hidden />
          {event.status === "CLOSED" ? "Publicar otra vez" : "Publicar"}
        </Button>
      ) : null}
    </>
  );
};

export default FreeEventDetailActions;
