"use client";

import { BookUser, CalendarCheck, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Input } from "@/app/components/ui/input";
import CrmPageShell from "../crm/CrmPageShell";
import { MODE_LABEL, agoLabel, useNow } from "./status";

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
};

/** Quién escribe y qué recuerda la IA de cada persona. */
const WhatsAppPeopleClient = () => {
  const [items, setItems] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const now = useNow(true, 60_000);

  const load = useCallback(async (query: string) => {
    const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    const res = await fetch(`/api/admin/whatsapp/people${params}`, { cache: "no-store" }).catch(
      () => null
    );
    if (res?.ok) setItems(((await res.json()) as { items: Person[] }).items);
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  return (
    <CrmPageShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Personas</h1>
        <span className="text-xs text-muted-foreground">
          Lo que la IA recuerda de cada persona. Se edita desde su chat.
        </span>
      </div>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load(q)}
          placeholder="Buscar nombre o número"
          className="pl-7"
        />
      </div>
      {items === null ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nadie ha escrito todavía.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <Link
              key={p.conversationId}
              href={`/admin/whatsapp?conversation=${p.conversationId}`}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="text-[11px] text-muted-foreground">{agoLabel(p.lastMessageAt, now)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>+{p.phone}</span>
                <span>· {MODE_LABEL[p.aiMode]}</span>
                {p.inAddressBook && (
                  <span className="inline-flex items-center gap-0.5">
                    <BookUser className="size-3" /> en tu libreta
                  </span>
                )}
                {p.bookings > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-sky-700">
                    <CalendarCheck className="size-3" /> {p.bookings} cita(s)
                  </span>
                )}
                {p.contactId && <span className="text-emerald-700">· en el CRM</span>}
              </div>
              <p className="line-clamp-5 whitespace-pre-wrap text-xs">
                {p.memory ?? <span className="text-muted-foreground">La IA aún no guarda nada de esta persona.</span>}
              </p>
            </Link>
          ))}
        </div>
      )}
    </CrmPageShell>
  );
};

export default WhatsAppPeopleClient;
