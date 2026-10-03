"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useCrm } from "../CrmProvider";

/** Lo que las acciones necesitan saber de una edición. */
export type EditionActionTarget = {
  id: string;
  /** Lo que va en la URL de su API: el id de un evento, el slug de un taller. */
  key: string;
  title: string;
  registrations: number;
};

export type EditionOther = { id: string; title: string } | null | undefined;

/**
 * Lo que cambia entre eventos y talleres: dónde está su API, adónde ir tras
 * crear una copia y cómo se dice cada cosa. Las acciones son las mismas.
 */
export type EditionActionsConfig = {
  apiBase: (key: string) => string;
  /** Tras duplicar: la pestaña «Página» de la copia, o null si la respuesta no la trae. */
  createdHref: (data: Record<string, unknown>) => string | null;
  copy: {
    publishTitle: string;
    publishMessage: (e: EditionActionTarget, other: EditionOther) => string;
    /** Tras «Falta …»: dónde se completa. */
    notPublishableHint: string;
    unpublishMessage: string;
    endTitle: string;
    endMessage: (e: EditionActionTarget) => string;
    endDone: string;
    reopenDone: string;
    duplicateDone: string;
    removeTitle: string;
    removeMessage: (e: EditionActionTarget) => string;
    removeDone: string;
  };
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
 * Publicar, cerrar inscripciones, terminar, reabrir, duplicar y borrar una
 * edición, con su confirmación. Lo comparten la lista y el detalle de eventos
 * y de talleres.
 */
export const useEditionActions = (config: EditionActionsConfig) => {
  const router = useRouter();
  const { toast, confirm } = useCrm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { apiBase, copy } = config;

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
   * Publicar cierra las inscripciones de la que estuviera publicada: se dice
   * en la confirmación, con su nombre, para que no sea una sorpresa.
   */
  const publish = (e: EditionActionTarget, openOther?: EditionOther) =>
    confirm({
      title: copy.publishTitle,
      message: copy.publishMessage(e, openOther && openOther.id !== e.id ? openOther : null),
      confirmLabel: "Publicar",
      onConfirm: () =>
        run(e.id, async () => {
          const r = await post(`${apiBase(e.key)}/publish`);
          if (!r.ok) {
            toast(
              r.data.error === "not_publishable"
                ? `${messageOf(r, "Falta completar la página")}. ${copy.notPublishableHint}`
                : messageOf(r, "No se pudo publicar."),
              "error"
            );
            return;
          }
          toast("Publicado", "success");
          router.refresh();
        }),
    });

  const unpublish = (e: EditionActionTarget) =>
    confirm({
      title: "Cerrar inscripciones",
      message: copy.unpublishMessage,
      confirmLabel: "Cerrar inscripciones",
      onConfirm: () =>
        run(e.id, async () => {
          const r = await post(`${apiBase(e.key)}/unpublish`);
          if (!r.ok) return void toast(messageOf(r, "No se pudo cerrar."), "error");
          toast("Inscripciones cerradas");
          router.refresh();
        }),
    });

  const end = (e: EditionActionTarget) =>
    confirm({
      title: copy.endTitle,
      message: copy.endMessage(e),
      confirmLabel: "Terminar",
      destructive: true,
      onConfirm: () =>
        run(e.id, async () => {
          const r = await post(`${apiBase(e.key)}/end`);
          if (!r.ok) return void toast(messageOf(r, "No se pudo terminar."), "error");
          toast(copy.endDone);
          router.refresh();
        }),
    });

  const reopen = (e: EditionActionTarget) =>
    run(e.id, async () => {
      const r = await post(`${apiBase(e.key)}/reopen`);
      if (!r.ok) return void toast(messageOf(r, "No se pudo reabrir."), "error");
      toast(copy.reopenDone);
      router.refresh();
    });

  /** Un borrador con la misma página, y se abre para ponerle fecha. */
  const duplicate = (e: EditionActionTarget) =>
    run(e.id, async () => {
      const r = await post(`${apiBase(e.key)}/duplicate`);
      const href = r.ok ? config.createdHref(r.data) : null;
      if (!href) return void toast(messageOf(r, "No se pudo duplicar."), "error");
      toast(copy.duplicateDone, "success");
      router.push(href);
    });

  const remove = (e: EditionActionTarget, after?: () => void) =>
    confirm({
      title: copy.removeTitle,
      message: copy.removeMessage(e),
      confirmLabel: "Eliminar",
      destructive: true,
      onConfirm: () =>
        run(e.id, async () => {
          const r = await post(apiBase(e.key), "DELETE");
          if (!r.ok) return void toast(messageOf(r, "No se pudo eliminar."), "error");
          toast(copy.removeDone);
          if (after) after();
          else router.refresh();
        }),
    });

  return { busyId, publish, unpublish, end, reopen, duplicate, remove };
};

export type EditionActions = ReturnType<typeof useEditionActions>;
