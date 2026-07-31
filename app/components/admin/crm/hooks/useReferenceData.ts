"use client";

import { useEffect, useState } from "react";
import type { ProductOption } from "@/lib/crm/product-kind-labels";

/**
 * Caché de datos de referencia a nivel de módulo: sobrevive a los
 * montajes/desmontajes de los modales y dedupe aperturas concurrentes.
 * TTL corto — los datos de referencia cambian poco y se invalidan al guardar.
 */
type CacheEntry = { promise: Promise<unknown>; at: number };

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60_000;

export const fetchCachedJson = <T,>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = fetcher().catch((err) => {
    // No cachear errores: la próxima apertura reintenta.
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw err;
  });
  cache.set(key, { promise, at: Date.now() });
  return promise;
};

export const invalidateCached = (key: string) => {
  cache.delete(key);
};

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch_failed:${url}`);
  return (await res.json()) as T;
};

export type ActiveProduct = ProductOption & {
  isActive: boolean;
  prices: { currency: string; amountMinor: number }[];
};

export const useActiveProducts = (enabled = true) => {
  const [products, setProducts] = useState<ActiveProduct[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchCachedJson("products", () =>
      getJson<{ products?: ActiveProduct[] }>("/api/admin/products")
    )
      .then((d) => {
        if (cancelled) return;
        setProducts((d.products ?? []).filter((p) => p.isActive));
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { products: products ?? [], productsLoading: products === null };
};

export type WorkshopEdition = { id: string; slug: string; title: string };

export const useWorkshopEditions = (enabled = true) => {
  const [editions, setEditions] = useState<WorkshopEdition[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchCachedJson("workshops", () =>
      getJson<{ editions?: WorkshopEdition[] }>("/api/admin/workshops")
    )
      .then((d) => {
        if (cancelled) return;
        setEditions(d.editions ?? []);
      })
      .catch(() => {
        if (!cancelled) setEditions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { workshops: editions ?? [], workshopsLoading: editions === null };
};
