"use client";

import { useEffect, useSyncExternalStore } from "react";

/** La clave que lee `/llamada` para ofrecer «Ver mi llamada» (contrato del embudo). */
const TOKEN_KEY = "dayana_llamada_token";

let cachedZone: string | null | undefined;

/** La zona del navegador, comprobada una vez (algunos devuelven «Etc/Unknown» o nada). */
const browserZone = (): string | null => {
  if (cachedZone !== undefined) return cachedZone;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Lanza si `Intl` no conoce esa zona: entonces se usa la de respaldo.
    new Intl.DateTimeFormat("es-CO", { timeZone: zone }).format(0);
    cachedZone = zone || null;
  } catch {
    cachedZone = null;
  }
  return cachedZone;
};

const serverZone = (): null => null;

/** La zona del navegador no cambia mientras la página está abierta. */
const subscribe = (): (() => void) => () => undefined;

/**
 * La zona horaria en la que se le muestra la cita a quien mira.
 *
 * El servidor no conoce la zona del navegador, así que pinta con `fallback`
 * (la que la persona dio al registrarse o, si no, la de Dayana). Durante la
 * hidratación React usa ese mismo valor (`serverZone`), de modo que el HTML
 * del servidor y el primer render del navegador coinciden; justo después, si
 * el navegador está en otra zona, vuelve a pintar con la suya. Sin `useEffect`
 * + `setState` y sin un hueco vacío mientras carga.
 */
export const useViewerZone = (fallback: string): string => useSyncExternalStore(subscribe, browserZone, serverZone) ?? fallback;

/** Guarda el enlace en este navegador: quien vuelva a `/llamada` va directo a su página. */
export const useRememberToken = (token: string): void => {
  useEffect(() => {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Navegación privada o almacenamiento bloqueado: la página funciona igual.
    }
  }, [token]);
};
