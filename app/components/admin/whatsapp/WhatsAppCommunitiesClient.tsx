"use client";

import { Archive, Copy, Link2, Loader2, Plus, Search, UserCheck, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Input } from "@/app/components/ui/input";
import CrmPageShell from "../crm/CrmPageShell";
import { useCrm } from "../crm/CrmProvider";
import CommunityFormDialog from "./CommunityFormDialog";

type Item = {
  id: string;
  name: string;
  kind: "community" | "group";
  parentName: string | null;
  inviteLink: string | null;
  description: string | null;
  counts: { INVITED: number; JOINED: number; LEFT: number; DECLINED: number };
};

export const copyText = async (text: string, toast: (m: string, t: "success" | "error") => unknown) => {
  try {
    await navigator.clipboard.writeText(text);
    toast("Enlace copiado", "success");
  } catch {
    toast("No se pudo copiar", "error");
  }
};

/** Las comunidades y grupos de WhatsApp que Dayana administra. */
const WhatsAppCommunitiesClient = () => {
  const { toast, canWrite } = useCrm();
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [parents, setParents] = useState<{ id: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (query: string, showArchived: boolean) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (showArchived) params.set("archived", "1");
    const res = await fetch(`/api/admin/whatsapp/communities?${params}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { items: Item[] };
    setItems(data.items);
    if (!query.trim() && !showArchived) {
      setParents(data.items.filter((i) => i.kind === "community").map((i) => ({ id: i.id, name: i.name })));
    }
  }, []);

  useEffect(() => {
    void load(q, archived);
    // La búsqueda se lanza con Enter; el interruptor de archivadas, al cambiar.
  }, [archived, load]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <CrmPageShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <UsersRound className="size-5 text-[#008069]" /> Comunidades
        </h1>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069]"
          >
            <Plus className="size-4" /> Nueva comunidad
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load(q, archived)}
            placeholder="Buscar comunidad"
            className="pl-7"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-4 accent-[#00a884]" />
          <Archive className="size-3.5" /> Archivadas
        </label>
      </div>

      {items === null ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          <UsersRound className="mx-auto mb-2 size-8 text-[#00a884]" />
          {archived
            ? "No hay comunidades archivadas."
            : "Los mensajes del grupo se quedan en tu celular; aquí llevas quién está y mandas las invitaciones."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <div key={c.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
              <Link href={`/admin/whatsapp/comunidades/${c.id}`} className="min-w-0 hover:underline">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {c.kind === "community" ? "Comunidad" : "Grupo"}
                  {c.parentName ? ` · en ${c.parentName}` : ""}
                </div>
              </Link>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 text-[#008069]">
                  <UserCheck className="size-3.5" /> {c.counts.JOINED} están
                </span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <UserPlus className="size-3.5" /> {c.counts.INVITED} invitadas
                </span>
              </div>
              {c.inviteLink ? (
                <button
                  type="button"
                  onClick={() => void copyText(c.inviteLink!, toast)}
                  className="inline-flex min-w-0 items-center gap-1.5 self-start rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/70"
                  title="Copiar enlace"
                >
                  <Copy className="size-3.5 shrink-0" />
                  <span className="truncate">{c.inviteLink.replace(/^https?:\/\//, "")}</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Link2 className="size-3.5" /> Sin enlace de invitación
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <CommunityFormDialog
        key={creating ? "new" : "idle"}
        open={creating}
        onClose={() => setCreating(false)}
        parents={parents}
        onSaved={(saved) => {
          router.push(`/admin/whatsapp/comunidades/${saved.id}`);
        }}
      />
    </CrmPageShell>
  );
};

export default WhatsAppCommunitiesClient;
