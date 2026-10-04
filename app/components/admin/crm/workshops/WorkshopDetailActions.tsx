"use client";

import EditionDetailActions from "../editions/EditionDetailActions";
import type { EditionStatus } from "../editions/status";
import { WORKSHOP_ACTIONS } from "./actions-config";

type Props = {
  edition: { id: string; slug: string; title: string; status: EditionStatus; paid: number };
  /** La publicada ahora, si es otra: se nombra al publicar esta. */
  openOther: { id: string; title: string } | null;
  /** Lo que falta para publicar, ya dicho («Falta el precio en pesos (COP)»). */
  publishBlockedReason: string | null;
  /** OWNER ve la versión pagada de cualquier edición, también en borrador. */
  ownerPreview: boolean;
};

/**
 * Las acciones de la cabecera de un taller, las mismas que las de un evento:
 * verlo en la web, duplicarlo, el paso que le toca y borrarlo (solo sin pagos
 * y sin publicar).
 */
const WorkshopDetailActions = ({ edition, openOther, publishBlockedReason, ownerPreview }: Props) => (
  <EditionDetailActions
    config={WORKSHOP_ACTIONS}
    target={{ id: edition.id, key: edition.slug, title: edition.title, registrations: edition.paid, status: edition.status }}
    publicLink={{
      href: `/taller-virtual/${edition.slug}`,
      label: ownerPreview && edition.status === "DRAFT" ? "Ver página pública (vista previa)" : "Ver página pública",
      copy: edition.status !== "DRAFT",
      disabledReason:
        edition.status === "DRAFT" && !ownerPreview ? "Es un borrador: aún no tiene página pública." : undefined,
    }}
    openOther={openOther}
    canDuplicate
    deleteBlockedReason={
      edition.paid > 0
        ? "Tiene inscripciones pagadas: no se borra, queda en la historia."
        : edition.status === "OPEN"
          ? "Está publicado: cierra las inscripciones antes de borrarlo."
          : null
    }
    afterDeleteHref="/admin/workshops"
    publishBlockedReason={publishBlockedReason}
  />
);

export default WorkshopDetailActions;
