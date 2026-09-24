"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveState } from "./SaveIndicator";

type Body = Record<string, unknown>;
type Request = { url: string; body: Body };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Mezcla dos cambios pendientes del mismo ajuste (las listas se reemplazan). */
const mergeBodies = (a: unknown, b: unknown): unknown => {
  if (!isPlainObject(a) || !isPlainObject(b)) return b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? mergeBodies(a[k], v) : v;
  return out;
};

/** `"booking.bufferMin", 10` → `{ booking: { bufferMin: 10 } }`. */
export const patchAt = (path: string, value: unknown): Body =>
  path
    .split(".")
    .reverse()
    .reduce<unknown>((acc, key) => ({ [key]: acc }), value) as Body;

/** Copia con `path` cambiado, sin tocar el original. */
export const setIn = <T>(obj: T, path: string, value: unknown): T => {
  const [head, ...rest] = path.split(".");
  const base = obj as Record<string, unknown>;
  return {
    ...base,
    [head]: rest.length ? setIn(base[head], rest.join("."), value) : value,
  } as T;
};

const ERROR_TEXT: Record<string, string> = {
  invalid_body: "Revisa este dato.",
  unauthorized: "Tu sesión terminó. Vuelve a entrar.",
  forbidden: "Solo la dueña puede cambiar esto.",
};

/**
 * Guardado automático por ajuste. Cada cambio se manda solo (los textos con
 * una pausa de ~600 ms, los interruptores al instante) y en orden: dos
 * cambios seguidos nunca llegan al revés. El estado de cada ajuste se lee con
 * `states[key]` para pintar «Guardando… / Guardado / error».
 */
export const useAutosave = ({
  disabled = false,
  errorText = {},
}: { disabled?: boolean; errorText?: Record<string, string> } = {}) => {
  const [states, setStates] = useState<Record<string, SaveState | undefined>>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, Request>());
  const seq = useRef(new Map<string, number>());
  const errorTextRef = useRef(errorText);
  // «Reintentar» vuelve a llamar a `send`, que se declara más abajo.
  const retryRef = useRef<(key: string, req: Request) => void>(() => {});
  useEffect(() => {
    errorTextRef.current = errorText;
  });

  const setState = useCallback((key: string, state: SaveState | undefined) => {
    setStates((all) => ({ ...all, [key]: state }));
  }, []);

  const send = useCallback(
    (key: string, req: Request) => {
      const mine = (seq.current.get(key) ?? 0) + 1;
      seq.current.set(key, mine);
      setState(key, { status: "saving" });

      if (disabled) {
        setState(key, { status: "error", error: "Vista previa: no se guarda." });
        return;
      }

      queue.current = queue.current.then(async () => {
        let next: SaveState;
        try {
          const res = await fetch(req.url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
          });
          if (res.ok) {
            next = { status: "saved" };
          } else {
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
              issues?: { path: string; message: string }[];
            };
            const error =
              data.issues?.[0]?.message ??
              errorTextRef.current[data.error ?? ""] ??
              ERROR_TEXT[data.error ?? ""] ??
              "No se pudo guardar.";
            next = { status: "error", error, retry: () => retryRef.current(key, req) };
          }
        } catch {
          next = { status: "error", error: "Sin conexión.", retry: () => retryRef.current(key, req) };
        }
        // Una respuesta vieja no pisa el estado de un cambio más nuevo.
        if (seq.current.get(key) !== mine) return;
        setState(key, next);
        if (next.status === "saved") {
          setTimeout(() => {
            if (seq.current.get(key) === mine) setState(key, undefined);
          }, 2500);
        }
      });
    },
    [disabled, setState]
  );

  useEffect(() => {
    retryRef.current = send;
  }, [send]);

  /** Guarda `body` en `url` para el ajuste `key`, tras `delay` ms sin cambios. */
  const save = useCallback(
    (key: string, url: string, body: Body, delay = 0, merge = true) => {
      const prev = pending.current.get(key);
      const req: Request = {
        url,
        body: prev && prev.url === url && merge ? (mergeBodies(prev.body, body) as Body) : body,
      };
      const t = timers.current.get(key);
      if (t) clearTimeout(t);
      if (delay <= 0) {
        pending.current.delete(key);
        timers.current.delete(key);
        send(key, req);
        return;
      }
      pending.current.set(key, req);
      setState(key, { status: "saving" });
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          pending.current.delete(key);
          send(key, req);
        }, delay)
      );
    },
    [send, setState]
  );

  /** Marca un ajuste con un error propio (validación antes de mandar). */
  const fail = useCallback(
    (key: string, error: string) => {
      const t = timers.current.get(key);
      if (t) clearTimeout(t);
      timers.current.delete(key);
      pending.current.delete(key);
      seq.current.set(key, (seq.current.get(key) ?? 0) + 1);
      setState(key, { status: "error", error });
    },
    [setState]
  );

  // Si se cierra la pestaña con un texto a medio guardar, se manda igual.
  useEffect(() => {
    const flush = () => {
      for (const [key, req] of pending.current) {
        clearTimeout(timers.current.get(key));
        void fetch(req.url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          keepalive: true,
        }).catch(() => {});
      }
      pending.current.clear();
      timers.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return { states, save, fail };
};

export type Autosave = ReturnType<typeof useAutosave>;
