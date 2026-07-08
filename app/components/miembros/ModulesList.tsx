"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Lock, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/app/components/ui/input";

type ModuleRow = { id: string; title: string };

const moduleRowClass =
  "flex items-center gap-4 rounded-xl bg-card px-5 py-4 text-sm ring-1 ring-foreground/10 transition-shadow";

const ModulesList = ({
  modules,
  isCurrent,
  completedIds = new Set(),
}: {
  modules: ModuleRow[];
  isCurrent: boolean;
  completedIds?: Set<string>;
}) => {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? modules.filter((m) =>
        m.title.toLowerCase().includes(query.trim().toLowerCase())
      )
    : modules;

  return (
    <div className="space-y-4">
      {modules.length > 3 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar módulo…"
            className="pl-9"
          />
        </div>
      )}

      {filtered.length > 0 ? (
        <ul className="space-y-3">
          {filtered.map((mod) => {
            const i = modules.indexOf(mod);
            const completed = completedIds.has(mod.id);
            return (
              <li key={mod.id}>
                {isCurrent ? (
                  <Link
                    href={`/miembros/modulos/${mod.id}`}
                    className={cn(moduleRowClass, "hover:shadow-md")}
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                        completed
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-accent/40 text-primary"
                      )}
                    >
                      {completed ? <Check className="size-4" /> : i + 1}
                    </span>
                    <span className="text-sm font-medium">{mod.title}</span>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
                  </Link>
                ) : (
                  <div className={cn(moduleRowClass, "opacity-70")}>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-500">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {mod.title}
                    </span>
                    <Lock className="ml-auto size-4 text-muted-foreground" aria-hidden />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Sin resultados para «{query}».</p>
      )}
    </div>
  );
};

export default ModulesList;
