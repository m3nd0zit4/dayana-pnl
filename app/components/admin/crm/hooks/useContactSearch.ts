"use client";

import { useEffect, useState } from "react";

export type ContactSearchHit = {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  phoneE164: string;
  email: string | null;
};

type Options = {
  /** Sin buscar mientras es `false` (p. ej. el desplegable está cerrado). */
  enabled?: boolean;
  /** Caracteres mínimos para consultar; por debajo no hay resultados. */
  minLength?: number;
  limit?: number;
  debounceMs?: number;
};

/**
 * Búsqueda de contactos en servidor con debounce y cancelación de la petición
 * anterior. Compartida por el buscador de la barra, el selector de contacto de
 * los formularios y el vínculo de conversaciones de la bandeja.
 */
export function useContactSearch(
  query: string,
  { enabled = true, minLength = 0, limit = 25, debounceMs = 350 }: Options = {}
) {
  // Los resultados guardan el término que los produjo: así no reaparecen los
  // de una búsqueda anterior mientras corre el debounce de la nueva.
  const [result, setResult] = useState<{ term: string; hits: ContactSearchHit[] }>({
    term: "",
    hits: [],
  });
  const [loading, setLoading] = useState(false);
  const term = query.trim();
  const active = enabled && term.length >= minLength;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (term) params.set("q", term);
        const res = await fetch(`/api/admin/contacts/search?${params}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { contacts?: ContactSearchHit[] };
        setResult({ term, hits: data.contacts ?? [] });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResult({ term, hits: [] });
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, term, limit, debounceMs]);

  // Derivado en vez de limpiar en un efecto: evita un render extra.
  return {
    hits: active && result.term === term ? result.hits : [],
    loading: active && loading,
  };
}
