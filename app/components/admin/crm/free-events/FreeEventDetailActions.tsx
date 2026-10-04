"use client";

import EditionDetailActions from "../editions/EditionDetailActions";
import type { EditionStatus } from "../editions/status";
import { FREE_EVENT_ACTIONS } from "./actions-config";

type Props = {
  event: {
    id: string;
    headline: string;
    status: EditionStatus;
    publicPath: string;
    registrations: number;
  };
  /** El que está publicado ahora, si es otro: se nombra al publicar este. */
  openOther: { id: string; headline: string } | null;
  editionsEnabled: boolean;
};

/**
 * Las acciones de la cabecera de un evento: verlo en la web, duplicarlo, el
 * paso que le toca según su estado y borrarlo (solo sin inscritas y sin
 * publicar). Las comparte con los talleres (`EditionDetailActions`).
 */
const FreeEventDetailActions = ({ event, openOther, editionsEnabled }: Props) => (
  <EditionDetailActions
    config={FREE_EVENT_ACTIONS}
    target={{
      id: event.id,
      key: event.id,
      title: event.headline,
      registrations: event.registrations,
      status: event.status,
    }}
    publicLink={{
      href: event.status === "OPEN" ? "/eventos-gratuitos" : event.publicPath,
      label: "Ver página pública",
      copy: event.status !== "DRAFT",
      disabledReason: event.status === "DRAFT" ? "Es un borrador: aún no tiene página pública." : undefined,
    }}
    openOther={openOther ? { id: openOther.id, title: openOther.headline } : null}
    canDuplicate={editionsEnabled}
    deleteBlockedReason={
      event.registrations > 0
        ? "Tiene inscritas: no se borra, queda en la historia."
        : event.status === "OPEN"
          ? "Está publicado: cierra las inscripciones antes de borrarlo."
          : null
    }
    afterDeleteHref="/admin/eventos"
  />
);

export default FreeEventDetailActions;
