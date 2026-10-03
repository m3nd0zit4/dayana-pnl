"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCrm, type ConfirmOptions } from "../CrmProvider";

/**
 * «Cambios sin guardar»: un editor de página avisa antes de que se pierdan.
 * Cubre las tres salidas que hay en el panel: cerrar o recargar la pestaña
 * (`beforeunload`), tocar un enlace (menú, barra inferior, volver) y cambiar
 * de pestaña del detalle (`EditionTabs` pregunta aquí).
 */

let dirtyNow = false;

/** ¿Hay un editor con cambios sin guardar en pantalla? */
export const isEditorDirty = (): boolean => dirtyNow;

/** Pregunta antes de salir; si se confirma, se olvidan los cambios y se va. */
export const confirmLeave = (confirm: (opts: ConfirmOptions) => void, go: () => void) =>
  confirm({
    title: "Cambios sin guardar",
    message: "Si sales ahora se pierden los cambios que no guardaste.",
    confirmLabel: "Salir sin guardar",
    destructive: true,
    onConfirm: () => {
      dirtyNow = false;
      go();
    },
  });

/** Navega, preguntando antes si hay cambios sin guardar. */
export const guardedNavigate = (confirm: (opts: ConfirmOptions) => void, go: () => void) => {
  if (dirtyNow) confirmLeave(confirm, go);
  else go();
};

export const useUnsavedChangesGuard = (dirty: boolean) => {
  const router = useRouter();
  const { confirm } = useCrm();

  useEffect(() => {
    dirtyNow = dirty;
    return () => {
      dirtyNow = false;
    };
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // En captura, antes de que `next/link` navegue.
    const onClick = (e: MouseEvent) => {
      if (!dirtyNow || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      confirmLeave(confirm, () => router.push(`${url.pathname}${url.search}${url.hash}`));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, confirm, router]);
};

/**
 * ¿Hay cambios? Compara lo que se mandaría ahora (`current`, serializado)
 * con lo último guardado. `reset` toma lo de ahora como guardado: tras
 * guardar o descartar, en el mismo render en que llegan los valores nuevos.
 */
export const useDirtyBaseline = (current: string) => {
  const [tick, setTick] = useState(0);
  const [synced, setSynced] = useState({ tick: 0, value: current });
  if (synced.tick !== tick) setSynced({ tick, value: current });
  return { dirty: synced.tick === tick && synced.value !== current, reset: () => setTick((t) => t + 1) };
};
