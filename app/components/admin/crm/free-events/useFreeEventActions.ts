"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useCrm } from "../CrmProvider";

/** Lo que las acciones necesitan saber de un evento. */
export type FreeEventActionTarget = {
  id: string;
  headline: string;
  registrations: number;
};

type ApiResult = { ok: boolean; data: Record<string, unknown> };

const post = async (url: string, method = "POST"): Promise<ApiResult> => {
  const res = await fetch(url, { method });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
};

const messageOf = (r: ApiResult, fallback: string) =>
  typeof r.data.message === "string" && r.data.message ? r.data.message : fallback;

/**
 * Publicar, cerrar inscripciones, terminar, reabrir, duplicar y borrar un
 * evento, con su confirmación. Lo comparten la lista y el detail.
 */
export const useFreeEventActions = () => {
  const router = useRouter();
  const { toast, confirm } = useCrm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = useCallback(
    async (id: string, fn: () => Promise<void>) => {
      setBusyId(id);
      try {
        await fn();
      } catch {
        toast("No se pudo hacer. Inténtalo de nuevo.", "error");
      } finally {
        setBusyId(null);
      }
    },
    [toast]
  );

  /**
   * Publicar cierra las inscripciones del que estuviera publicado: se dice en
   * la confirmación, con su nombre, para que no sea una sorpresa.
   */
  const publish = (e: FreeEventActionTarget, openOther?: { id: string; headline: string } | null) =>
    confirm({
      title: "Publicar evento",
      message:
        openOther && openOther.id !== e.id
          ? `«${e.headline}» pasa a /eventos-gratuitos y empieza a aceptar inscripciones. «${openOther.headline}» deja de aceptarlas; sus inscritas siguen recibiendo el enlace y los recordatorios.`
          : `«${e.headline}» pasa a /eventos-gratuitos y empieza a aceptar inscripciones.`,
      confirmLabel: "Publicar",
      onConfirm: () =>
        run(e.id, async () => {
          const r = await post(`/api/admin/eventos/${e.id}/publish`);
          if (!r.ok) {
            toast(
              r.data.error === "not_publishable"
                ? `${messageOf(r, "Falta completar la página")}. Complétalo en «Página».`
                : messageOf(r, "No se pudo publicar."),
              "error"
            );
            return;
          }
          toast("Publicado", "success");
          router.refresh();
        }),
    });

  const unpublish = (e: FreeEventActionTarget) =>
    confirm({
      title: "Cerrar inscripciones",
      message:
        "La página deja de aceptar inscripciones. Quien ya se inscribió sigue recibiendo el enlace y los recordatorios. Para cancelarlo del todo, «Terminar».",
      confirmLabel: "Cerrar inscripciones",
      onConfirm: () =>
        run(e.id, async () => {
          const r = await post(`/api/admin/eventos/${e.id}/unpublish`);
          if (!r.ok) return void toast(messageOf(r, "No se pudo cerrar."), "error");
          toast("Inscripciones cerradas");
          router.refresh();
        }),
    });

  const end = (e: FreeEventActionTarget) =>
    confirm({
      title: "Terminar evento",
      message: `«${e.headline}» deja de aceptar inscripciones y no sale ningún recordatorio más ni el enlace. Queda en «Pasados» con sus ${e.registrations.toLocaleString("es-CO")} inscritas y su historia. Se puede reabrir.`,
      confirmLabel: "Terminar",
      destructive: true,
      onConfirm: () =>
        run(e.id, async () => {
          const r = await post(`/api/admin/eventos/${e.id}/end`);
          if (!r.ok) return void toast(messageOf(r, "No se pudo terminar."), "error");
          toast("Evento terminado");
          router.refresh();
        }),
    });

  const reopen = (e: FreeEventActionTarget) =>
    run(e.id, async () => {
      const r = await post(`/api/admin/eventos/${e.id}/reopen`);
      if (!r.ok) return void toast(messageOf(r, "No se pudo reabrir."), "error");
      toast("Reabierto. Publícalo para volver a aceptar inscripciones.");
      router.refresh();
    });

  /** Un borrador con la misma página, y se abre para ponerle fecha. */
  const duplicate = (e: FreeEventActionTarget) =>
    run(e.id, async () => {
      const r = await post(`/api/admin/eventos/${e.id}/duplicate`);
      const created = r.data.webinar as { id?: string } | undefined;
      if (!r.ok || !created?.id) return void toast(messageOf(r, "No se pudo duplicar."), "error");
      toast("Borrador creado con la misma página. Ponle fecha.", "success");
      router.push(`/admin/eventos/${created.id}?tab=pagina`);
    });

  const remove = (e: FreeEventActionTarget, after?: () => void) =>
    confirm({
      title: "Eliminar evento",
      message: `Se borrará «${e.headline}». No tiene inscritas, así que no se pierde ninguna historia. No se puede deshacer.`,
      confirmLabel: "Eliminar",
      destructive: true,
      onConfirm: () =>
        run(e.id, async () => {
          const r = await post(`/api/admin/eventos/${e.id}`, "DELETE");
          if (!r.ok) return void toast(messageOf(r, "No se pudo eliminar."), "error");
          toast("Evento eliminado");
          if (after) after();
          else router.refresh();
        }),
    });

  return { busyId, publish, unpublish, end, reopen, duplicate, remove };
};
