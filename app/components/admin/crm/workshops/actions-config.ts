import type { EditionActionsConfig } from "../editions/useEditionActions";

/** Las acciones de una edición de taller: su API (por URL) y sus palabras. */
export const WORKSHOP_ACTIONS: EditionActionsConfig = {
  apiBase: (slug) => `/api/admin/workshops/${encodeURIComponent(slug)}`,
  createdHref: (data) => {
    const created = data.edition as { slug?: string } | undefined;
    return created?.slug ? `/admin/workshops/${encodeURIComponent(created.slug)}?tab=pagina` : null;
  },
  copy: {
    publishTitle: "Publicar taller",
    publishMessage: (e, other) =>
      other
        ? `«${e.title}» pasa a /taller-virtual y empieza a venderse. «${other.title}» deja de venderse; quien ya pagó sigue recibiendo el enlace y los recordatorios.`
        : `«${e.title}» pasa a /taller-virtual y empieza a venderse.`,
    notPublishableHint: "Complétalo en «Página» y «Precio».",
    unpublishMessage:
      "Deja de venderse. Quien ya pagó sigue recibiendo el enlace y los recordatorios. Para darlo por realizado, «Terminar».",
    endTitle: "Terminar taller",
    endMessage: (e) =>
      `«${e.title}» deja de venderse y no sale ningún recordatorio más. Queda en «Pasados» con sus ${e.registrations.toLocaleString("es-CO")} inscritas y su historia. Se puede reabrir.`,
    endDone: "Taller terminado",
    reopenDone: "Reabierto. Publícalo para volver a venderlo.",
    duplicateDone: "Borrador creado con la misma página. Ponle fecha y precio.",
    removeTitle: "Eliminar taller",
    removeMessage: (e) =>
      `Se borrará «${e.title}». No tiene pagos, así que no se pierde ninguna historia. No se puede deshacer.`,
    removeDone: "Taller eliminado",
  },
};
