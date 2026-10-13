"use client";

import { BookUser, CalendarCheck, Search, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Input } from "@/app/components/ui/input";
import { CHAT_CATEGORY_LABEL, isChatCategory } from "@/lib/crm/chat-category-rules";
import { STAGE_LABEL, STAGES, isStage, type Stage } from "@/lib/crm/whatsapp-agent/stage";
import { cn } from "@/lib/utils";
import CrmPageHeader from "../crm/CrmPageHeader";
import CrmPageShell from "../crm/CrmPageShell";
import { CrmEmptyState, CrmLoadingState } from "../crm/ui";
import type { CategoryCounts } from "@/lib/crm/chat-category";
import { CATEGORY_FILTERS, MODE_LABEL, agoLabel, categoryCountOf, showCategoryFilter, useNow } from "./status";

type Person = {
  conversationId: string;
  phone: string;
  name: string;
  contactId: string | null;
  aiMode: keyof typeof MODE_LABEL;
  lastMessageAt: string;
  messages: number;
  bookings: number;
  inAddressBook: boolean;
  memory: string | null;
  memoryUpdatedAt: string | null;
  category: string | null;
  categoryReview: boolean;
  stage: string | null;
  /** Resumen de la ficha (todo el chat). */
  summary: string | null;
};

const chipClass = (active: boolean) =>
  cn(
    "h-10 shrink-0 rounded-full px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:h-8",
    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
  );

/** Quién escribe, en qué estado está con Dayana y qué sabe la IA de cada persona. */
const WhatsAppPeopleClient = () => {
  const [items, setItems] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [counts, setCounts] = useState<CategoryCounts | null>(null);
  const [stageCounts, setStageCounts] = useState<Record<string, number> | null>(null);
  const now = useNow(true, 60_000);

  const load = useCallback(async (query: string, cat: string | null, st: Stage | null = null) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (cat) params.set("category", cat);
    if (st) params.set("stage", st);
    const res = await fetch(`/api/admin/whatsapp/people?${params}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setItems(((await res.json()) as { items: Person[] }).items);
  }, []);

  useEffect(() => {
    void load("", null);
    // Las cuentas solo esconden los filtros vacíos; si fallan, se enseñan todos.
    void fetch("/api/admin/whatsapp/categories", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<CategoryCounts>) : null))
      .then(setCounts, () => null);
    void fetch("/api/admin/whatsapp/segments", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ stages?: Record<string, number> }>) : null))
      .then((d) => setStageCounts(d?.stages ?? null), () => null);
  }, [load]);

  const pick = (next: string | null) => {
    setCategory(next);
    void load(q, next, stage);
  };
  const pickStage = (next: Stage | null) => {
    setStage(next);
    void load(q, category, next);
  };
  const stagesShown = STAGES.filter((s) => (stageCounts?.[s] ?? 0) > 0 || stage === s);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Personas"
        description="En qué punto está cada persona con Dayana y lo que la IA sabe de ella (su ficha). Se edita desde su chat."
      />
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load(q, category, stage)}
          placeholder="Buscar nombre o número"
          className="pl-7"
        />
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Categoría">
        {[{ id: null as string | null, label: "Todas" }, ...CATEGORY_FILTERS].map((f) => {
          const active = category === f.id;
          // Como en «Todos»: lo que no tiene a nadie no se enseña (salvo si está elegido).
          if (f.id && !showCategoryFilter(counts, f.id, active)) return null;
          return (
            <button
              key={f.id ?? "all"}
              type="button"
              aria-pressed={active}
              onClick={() => pick(f.id)}
              className={chipClass(active)}
            >
              {f.label}
              {/* Cuántas hay, como en los filtros de «Todos» de los chats. */}
              {f.id && counts ? (
                <span className={cn("ml-1 tabular-nums", active ? "opacity-80" : "text-muted-foreground/80")}>
                  {categoryCountOf(counts, f.id)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/* En qué punto está con Dayana (solo los estados que tienen a alguien). */}
      {stagesShown.length > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Estado">
          <button type="button" aria-pressed={stage === null} onClick={() => pickStage(null)} className={chipClass(stage === null)}>
            Todos los estados
          </button>
          {stagesShown.map((s) => (
            <button key={s} type="button" aria-pressed={stage === s} onClick={() => pickStage(s)} className={chipClass(stage === s)}>
              {STAGE_LABEL[s]}
              <span className={cn("ml-1 tabular-nums", stage === s ? "opacity-80" : "text-muted-foreground/80")}>{stageCounts?.[s] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      {items === null ? (
        <CrmLoadingState variant="card" rows={3} />
      ) : items.length === 0 ? (
        <CrmEmptyState
          icon={Users}
          title={category || stage || q.trim() ? "Nadie coincide con este filtro" : "Nadie ha escrito todavía"}
          description={
            category || stage || q.trim()
              ? "Prueba con otra categoría o borra la búsqueda."
              : "Cuando alguien escriba por WhatsApp, aquí verás lo que la IA recuerda de esa persona."
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <Link
              key={p.conversationId}
              href={`/admin/whatsapp?conversation=${p.conversationId}`}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate font-medium">{p.name}</span>
                {p.category && isChatCategory(p.category) && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                    {CHAT_CATEGORY_LABEL[p.category]}
                    {p.categoryReview ? " · por revisar" : ""}
                  </span>
                )}
                <span className="flex-1" />
                <span className="text-[11px] text-muted-foreground">{agoLabel(p.lastMessageAt, now)}</span>
              </div>
              {isStage(p.stage) && <span className="text-xs font-medium text-primary">{STAGE_LABEL[p.stage]}</span>}
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>+{p.phone}</span>
                <span>· {MODE_LABEL[p.aiMode]}</span>
                {p.inAddressBook && (
                  <span className="inline-flex items-center gap-0.5">
                    <BookUser className="size-3" /> en tu libreta
                  </span>
                )}
                {p.bookings > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-primary">
                    <CalendarCheck className="size-3" /> {p.bookings} {p.bookings === 1 ? "cita" : "citas"}
                  </span>
                )}
                {p.contactId && <span className="text-success">· en el CRM</span>}
              </div>
              <p className="line-clamp-5 whitespace-pre-wrap text-xs">
                {p.summary ?? p.memory ?? <span className="text-muted-foreground">La IA aún no guarda nada de esta persona.</span>}
              </p>
            </Link>
          ))}
        </div>
      )}
    </CrmPageShell>
  );
};

export default WhatsAppPeopleClient;
