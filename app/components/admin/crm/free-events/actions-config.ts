import type { EditionActionsConfig } from "../editions/useEditionActions";

/** Las acciones de un evento gratuito: su API y sus palabras. */
export const FREE_EVENT_ACTIONS: EditionActionsConfig = {
  apiBase: (id) => `/api/admin/eventos/${id}`,
  createdHref: (data) => {
    const created = data.webinar as { id?: string } | undefined;
    return created?.id ? `/admin/eventos/${created.id}?tab=pagina` : null;
  },
  copy: {
    publishTitle: "Publicar evento",
    publishMessage: (e, other) =>
      other
        ? `«${e.title}» pasa a /eventos-gratuitos y empieza a aceptar inscripciones. «${other.title}» deja de aceptarlas; sus inscritas siguen recibiendo el enlace y los recordatorios.`
        : `«${e.title}» pasa a /eventos-gratuitos y empieza a aceptar inscripciones.`,
    notPublishableHint: "Complétalo en «Página».",
    unpublishMessage:
      "La página deja de aceptar inscripciones. Quien ya se inscribió sigue recibiendo el enlace y los recordatorios. Para cancelarlo del todo, «Terminar».",
    endTitle: "Terminar evento",
    endMessage: (e) =>
      `«${e.title}» deja de aceptar inscripciones y no sale ningún recordatorio más ni el enlace. Queda en «Pasados» con sus ${e.registrations.toLocaleString("es-CO")} inscritas y su historia. Se puede reabrir.`,
    endDone: "Evento terminado",
    reopenDone: "Reabierto. Publícalo para volver a aceptar inscripciones.",
    duplicateDone: "Borrador creado con la misma página. Ponle fecha.",
    removeTitle: "Eliminar evento",
    removeMessage: (e) =>
      `Se borrará «${e.title}». No tiene inscritas, así que no se pierde ninguna historia. No se puede deshacer.`,
    removeDone: "Evento eliminado",
  },
};
