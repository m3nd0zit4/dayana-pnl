"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { searchSettingsHub, type SettingsHubGroup } from "@/lib/crm/settings-hub";

/**
 * Índice de `/admin/ajustes`: todo lo que se configura, agrupado por para qué
 * sirve, y un buscador que sabe dónde está cada ajuste (también los de
 * WhatsApp, uno por uno).
 *
 * No guarda nada: cada entrada lleva a la página donde ya vive el ajuste. Quien
 * no sabe en qué grupo está lo que busca, lo escribe.
 */
const SettingsHub = ({ groups, isOwner }: { groups: SettingsHubGroup[]; isOwner: boolean }) => {
  const router = useRouter();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const results = useMemo(
    () => searchSettingsHub(groups, query, { isOwner, limit: 12 }),
    [groups, query, isOwner]
  );

  return (
    <div className="space-y-6">
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          Buscar un ajuste
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={inputId}
          type="search"
          autoComplete="off"
          placeholder="Buscar un ajuste: zona horaria, correo, citas, contraseña…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            else if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              router.push(results[0].href);
            }
          }}
          className="h-11 pr-10 pl-10 [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            aria-label="Borrar búsqueda"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <p className="sr-only" role="status">
        {searching ? `${results.length} resultados` : ""}
      </p>

      {searching ? (
        results.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No encontré ese ajuste. Prueba con otra palabra, por ejemplo «correo», «citas» o «contraseña».
          </p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {results.map((hit) => (
                  <li key={`${hit.where}-${hit.id}`}>
                    <Link
                      href={hit.href}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="min-w-0 truncate font-medium">{hit.label}</span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {hit.where}
                        <ChevronRight className="size-3.5" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id}>
              <CardHeader>
                <CardTitle>{group.title}</CardTitle>
                <CardDescription>{group.purpose}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y border-t">
                  {group.items
                    .filter((item) => item.hidden !== "hub")
                    .map((item) => (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <span className="min-w-0">
                            <span className="block font-medium">{item.label}</span>
                            {item.hint ? (
                              <span className="block text-xs text-muted-foreground">{item.hint}</span>
                            ) : null}
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        </Link>
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default SettingsHub;
