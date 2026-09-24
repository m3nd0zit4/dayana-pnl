"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ClipboardPaste,
  Copy,
  Loader2,
  Pencil,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/app/components/ui/input";
import { displayContactPhone } from "@/lib/crm/contact-phone";
import { MEMBER_STATUS_LABEL, MEMBER_STATUSES, type MemberStatus } from "@/lib/crm/whatsapp-communities-core";
import type { WhatsAppStatus } from "@/lib/crm/whatsapp-outbound";
import { communityAnnouncePresets, communityInvitePresets } from "@/lib/crm/whatsapp-presets";
import CrmModal from "../crm/CrmModal";
import CrmPageShell from "../crm/CrmPageShell";
import { useCrm } from "../crm/CrmProvider";
import { useContactSearch } from "../crm/hooks/useContactSearch";
import CommunityFormDialog, { type CommunityFormValue } from "./CommunityFormDialog";
import { copyText } from "./WhatsAppCommunitiesClient";
import WhatsAppBulkSend from "./WhatsAppBulkSend";
import WhatsAppStatusBadge from "./WhatsAppStatusBadge";

type Member = {
  id: string;
  contactId: string;
  status: MemberStatus;
  joinedAt: string | null;
  invitedAt: string | null;
  inviteSendId: string | null;
  contact: { id: string; firstName: string; lastName: string | null; phoneE164: string };
};

type Community = {
  id: string;
  name: string;
  kind: "community" | "group";
  parentId: string | null;
  parent: { id: string; name: string } | null;
  children: { id: string; name: string }[];
  inviteLink: string | null;
  description: string | null;
  archivedAt: string | null;
  members: Member[];
  counts: Record<MemberStatus, number>;
};

type Tab = "JOINED" | "INVITED" | "OUT";

const TABS: { id: Tab; label: string; icon: typeof UserCheck }[] = [
  { id: "JOINED", label: "Miembros", icon: UserCheck },
  { id: "INVITED", label: "Invitados", icon: UserPlus },
  { id: "OUT", label: "Salieron", icon: UserMinus },
];

const inTab = (m: Member, tab: Tab) =>
  tab === "OUT" ? m.status === "LEFT" || m.status === "DECLINED" : m.status === tab;

const fullName = (c: { firstName: string; lastName: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ");

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "2-digit" }) : "—";

const postAction = async (id: string, body: Record<string, unknown>) => {
  const res = await fetch(`/api/admin/whatsapp/communities/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.message === "string" ? data.message : "No se pudo.");
  return data;
};

const pill = "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm hover:bg-muted disabled:opacity-40";

/** Una comunidad: quién está, a quién se invitó, invitar y anunciar 1 a 1. */
const WhatsAppCommunityDetailClient = ({ id }: { id: string }) => {
  const { toast, canWrite } = useCrm();
  const [community, setCommunity] = useState<Community | null>(null);
  const [missing, setMissing] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, WhatsAppStatus>>({});
  const [tab, setTab] = useState<Tab>("JOINED");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [parents, setParents] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/whatsapp/communities/${id}`, { cache: "no-store" }).catch(() => null);
    if (res?.status === 404) return setMissing(true);
    if (!res?.ok) return;
    const data = (await res.json()) as { community: Community; statuses: Record<string, WhatsAppStatus> };
    setCommunity(data.community);
    setStatuses(data.statuses);
  }, [id]);

  useEffect(() => {
    void load();
    void fetch("/api/admin/whatsapp/communities", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items: { id: string; name: string; kind: string }[] } | null) =>
        setParents((d?.items ?? []).filter((i) => i.kind === "community").map((i) => ({ id: i.id, name: i.name })))
      )
      .catch(() => undefined);
  }, [load]);

  const rows = useMemo(() => (community?.members ?? []).filter((m) => inTab(m, tab)), [community, tab]);
  const selectedIds = useMemo(() => [...selected], [selected]);
  const byContact = useMemo(() => new Map((community?.members ?? []).map((m) => [m.contactId, m])), [community]);

  // A quién invitar: las elegidas que no están, o las invitadas a las que aún no se les mandó.
  const inviteIds = useMemo(() => {
    const chosen = selectedIds.filter((cid) => byContact.get(cid)?.status !== "JOINED");
    if (selected.size > 0) return chosen;
    return (community?.members ?? []).filter((m) => m.status === "INVITED" && !m.inviteSendId).map((m) => m.contactId);
  }, [selectedIds, selected.size, byContact, community]);
  const joinedIds = useMemo(
    () => (community?.members ?? []).filter((m) => m.status === "JOINED").map((m) => m.contactId),
    [community]
  );

  const setStatus = async (contactIds: string[], status: MemberStatus) => {
    try {
      await postAction(id, { action: "set_status", contactIds, status });
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo.", "error");
    }
  };

  const toggleArchive = async () => {
    if (!community) return;
    const res = await fetch(`/api/admin/whatsapp/communities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !community.archivedAt }),
    });
    if (res.ok) {
      toast(community.archivedAt ? "Comunidad restaurada" : "Comunidad archivada", "success");
      void load();
    }
  };

  if (missing) {
    return (
      <CrmPageShell>
        <p className="text-sm text-muted-foreground">Esta comunidad no existe.</p>
        <Link href="/admin/whatsapp/comunidades" className="text-sm text-[#008069] hover:underline">
          Volver a Comunidades
        </Link>
      </CrmPageShell>
    );
  }
  if (!community) {
    return (
      <CrmPageShell>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </CrmPageShell>
    );
  }

  const formValue: CommunityFormValue = {
    id: community.id,
    name: community.name,
    kind: community.kind,
    parentId: community.parentId,
    inviteLink: community.inviteLink,
    description: community.description,
  };

  const allOnTab = rows.length > 0 && rows.every((m) => selected.has(m.contactId));

  return (
    <CrmPageShell>
      {/* Encabezado */}
      <div className="space-y-2">
        <Link href="/admin/whatsapp/comunidades" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="size-3.5" /> Comunidades
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-xl font-semibold">{community.name}</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {community.kind === "community" ? "Comunidad" : "Grupo"}
            {community.parent ? ` · en ${community.parent.name}` : ""}
          </span>
          {community.archivedAt && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Archivada</span>
          )}
          {canWrite && (
            <div className="ml-auto flex gap-1">
              <button type="button" onClick={() => setEditing(true)} className="rounded-full p-2 hover:bg-muted" title="Editar" aria-label="Editar">
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => void toggleArchive()}
                className="rounded-full p-2 hover:bg-muted"
                title={community.archivedAt ? "Restaurar" : "Archivar"}
                aria-label={community.archivedAt ? "Restaurar" : "Archivar"}
              >
                {community.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              </button>
            </div>
          )}
        </div>
        {community.inviteLink ? (
          <button
            type="button"
            onClick={() => void copyText(community.inviteLink!, toast)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:bg-muted/70"
          >
            <Copy className="size-3.5 shrink-0" />
            <span className="truncate">{community.inviteLink}</span>
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">Sin enlace de invitación: agrégalo con el lápiz para poder invitar.</p>
        )}
        {community.description && <p className="text-sm text-muted-foreground">{community.description}</p>}
        {community.children.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {community.children.map((ch) => (
              <Link key={ch.id} href={`/admin/whatsapp/comunidades/${ch.id}`} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">
                {ch.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Acciones */}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <button type="button" onClick={() => setAdding(true)} className={pill}>
            <UserPlus className="size-4" /> Agregar personas
          </button>
          <button type="button" onClick={() => setPasting(true)} className={pill}>
            <ClipboardPaste className="size-4" /> Marcar que ya entraron
          </button>
          {community.inviteLink && (
            <WhatsAppBulkSend
              contactIds={inviteIds}
              presets={communityInvitePresets(community)}
              kind="comunidad"
              title={`Invitación · ${community.name}`}
              label="Invitar por WhatsApp"
              create={async ({ contactIds, text }) => {
                const d = await postAction(id, { action: "invite", contactIds, text });
                return { id: String(d.id) };
              }}
              onDone={() => {
                setSelected(new Set());
                void load();
              }}
            />
          )}
          <WhatsAppBulkSend
            contactIds={joinedIds}
            presets={communityAnnouncePresets(community)}
            kind="comunidad"
            title={`Anuncio · ${community.name}`}
            label="Anunciar a los miembros"
            create={async ({ text }) => {
              const d = await postAction(id, { action: "announce", text });
              return { id: String(d.id) };
            }}
            onDone={() => void load()}
          />
        </div>
      )}

      {/* Pestañas */}
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const n = t.id === "OUT" ? community.counts.LEFT + community.counts.DECLINED : community.counts[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${tab === t.id ? "bg-[#00a884] text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
            >
              <Icon className="size-4" /> {t.label} <span className="text-xs opacity-80">{n}</span>
            </button>
          );
        })}
        {selected.size > 0 && (
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <X className="size-3.5" /> {selected.size} elegidas
          </button>
        )}
      </div>

      {/* Personas */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nadie aquí todavía.</p>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                aria-label="Elegir todas"
                checked={allOnTab}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    rows.forEach((m) => (allOnTab ? next.delete(m.contactId) : next.add(m.contactId)));
                    return next;
                  })
                }
                className="size-4 accent-[#00a884]"
              />
              <span className="flex-1">Persona</span>
              <span className="hidden w-36 md:block">WhatsApp</span>
              <span className="hidden w-20 md:block">{tab === "INVITED" ? "Invitada" : "Entró"}</span>
              <span className="w-28">Estado</span>
            </div>
            {rows.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-0">
                <input
                  type="checkbox"
                  aria-label={`Elegir a ${fullName(m.contact)}`}
                  checked={selected.has(m.contactId)}
                  onChange={() =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (next.has(m.contactId)) next.delete(m.contactId);
                      else next.add(m.contactId);
                      return next;
                    })
                  }
                  className="size-4 accent-[#00a884]"
                />
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/contacts/${m.contactId}`} className="block truncate text-sm font-medium hover:underline">
                    {fullName(m.contact)}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">
                    {displayContactPhone(m.contact.phoneE164) ?? "Sin número"}
                    <span className="md:hidden"> · {shortDate(tab === "INVITED" ? m.invitedAt : m.joinedAt)}</span>
                  </div>
                  <div className="md:hidden">
                    <WhatsAppStatusBadge status={statuses[m.contactId]} />
                  </div>
                </div>
                <div className="hidden w-36 md:block">
                  <WhatsAppStatusBadge status={statuses[m.contactId]} />
                </div>
                <span className="hidden w-20 text-xs text-muted-foreground md:block">
                  {shortDate(tab === "INVITED" ? m.invitedAt : m.joinedAt)}
                </span>
                <select
                  value={m.status}
                  disabled={!canWrite}
                  onChange={(e) => void setStatus([m.contactId], e.target.value as MemberStatus)}
                  aria-label="Estado"
                  className="h-8 w-28 rounded-lg border border-border bg-background px-1.5 text-xs"
                >
                  {MEMBER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {MEMBER_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </>
        )}
      </div>

      <CommunityFormDialog key={editing ? "edit" : "idle"} open={editing} onClose={() => setEditing(false)} initial={formValue} parents={parents} onSaved={() => void load()} />
      <AddPeopleDialog open={adding} onClose={() => setAdding(false)} communityId={id} existing={byContact} onAdded={() => void load()} />
      <PasteJoinedDialog open={pasting} onClose={() => setPasting(false)} communityId={id} onApplied={() => void load()} />
    </CrmPageShell>
  );
};

/** Buscar contactos y agregarlos (como invitadas o como que ya están). */
const AddPeopleDialog = ({
  open,
  onClose,
  communityId,
  existing,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  communityId: string;
  existing: Map<string, Member>;
  onAdded: () => void;
}) => {
  const { toast } = useCrm();
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState<"INVITED" | "JOINED">("INVITED");
  const [saving, setSaving] = useState(false);
  const { hits, loading } = useContactSearch(q, { enabled: open, minLength: 2, limit: 15 });

  const close = () => {
    setQ("");
    setChosen(new Map());
    onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      const d = await postAction(communityId, { action: "add_members", contactIds: [...chosen.keys()], status });
      toast(`${Number(d.added ?? 0)} agregadas`, "success");
      onAdded();
      close();
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CrmModal title="Agregar personas" open={open} onClose={() => !saving && close()}>
      <div className="space-y-3 text-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, teléfono o email" className="pl-7" autoFocus />
        </div>
        {chosen.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[...chosen].map(([cid, name]) => (
              <button
                key={cid}
                type="button"
                onClick={() =>
                  setChosen((s) => {
                    const next = new Map(s);
                    next.delete(cid);
                    return next;
                  })
                }
                className="inline-flex items-center gap-1 rounded-full bg-[#00a884]/15 px-2 py-0.5 text-xs text-[#008069] dark:text-[#25d366]"
              >
                {name} <X className="size-3" />
              </button>
            ))}
          </div>
        )}
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          {loading && <p className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>}
          {!loading && q.trim().length >= 2 && hits.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias</p>
          )}
          {!loading && q.trim().length < 2 && <p className="px-3 py-2 text-xs text-muted-foreground">Escribe para buscar.</p>}
          {!loading &&
            hits.map((h) => {
              const name = `${h.firstName} ${h.lastName ?? ""}`.trim();
              const already = existing.get(h.id);
              return (
                <label key={h.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/50">
                  <input
                    type="checkbox"
                    disabled={Boolean(already)}
                    checked={chosen.has(h.id) || Boolean(already)}
                    onChange={() =>
                      setChosen((s) => {
                        const next = new Map(s);
                        if (next.has(h.id)) next.delete(h.id);
                        else next.set(h.id, name);
                        return next;
                      })
                    }
                    className="size-4 accent-[#00a884]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {displayContactPhone(h.phoneE164) ?? "Sin teléfono"}
                      {already ? ` · ${MEMBER_STATUS_LABEL[already.status]}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Quedan como</span>
          {(["INVITED", "JOINED"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? "bg-[#00a884] text-white" : "bg-muted text-muted-foreground"}`}
            >
              {s === "INVITED" ? "Por invitar" : "Ya están"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || chosen.size === 0}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 font-medium text-white hover:bg-[#008069] disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Agregar {chosen.size || ""}
          </button>
        </div>
      </div>
    </CrmModal>
  );
};

type PasteResult = {
  matched: { contactId: string; name: string; phone: string; input: string; previous: MemberStatus | null }[];
  unknown: string[];
};

/** Pegar los números de la info del grupo → quiénes ya entraron. */
const PasteJoinedDialog = ({
  open,
  onClose,
  communityId,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  communityId: string;
  onApplied: () => void;
}) => {
  const { toast } = useCrm();
  const [text, setText] = useState("");
  const [result, setResult] = useState<PasteResult | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setText("");
    setResult(null);
    onClose();
  };

  const run = async (apply: boolean) => {
    setBusy(true);
    try {
      const d = (await postAction(communityId, { action: "mark_joined_paste", text, apply })) as unknown as PasteResult;
      if (apply) {
        toast(`${d.matched.length} marcadas como miembros`, "success");
        onApplied();
        close();
      } else setResult(d);
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo.", "error");
    } finally {
      setBusy(false);
    }
  };

  const toMark = result?.matched.filter((m) => m.previous !== "JOINED").length ?? 0;

  return (
    <CrmModal title="Marcar que ya entraron" open={open} onClose={() => !busy && close()} large>
      <div className="space-y-3 text-sm">
        {!result ? (
          <>
            <p className="text-xs text-muted-foreground">
              En el celular: info del grupo → participantes. Copia los números y pégalos aquí, en cualquier formato.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"+57 300 123 4567\n+52 1 55 1234 5678"}
              className="w-full rounded-lg border border-border bg-background p-2.5 font-mono text-xs outline-none focus:border-[#00a884]"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void run(false)}
                disabled={busy || !text.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 font-medium text-white hover:bg-[#008069] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Revisar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-[#008069] dark:text-[#25d366]">
                <UserCheck className="size-4" /> {result.matched.length} encontradas
              </div>
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {result.matched.map((m) => (
                  <li key={m.contactId} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="text-[11px] text-muted-foreground">{m.phone}</span>
                    <span className="w-20 text-right text-[11px] text-muted-foreground">
                      {m.previous ? MEMBER_STATUS_LABEL[m.previous] : "Nueva"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {result.unknown.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  {result.unknown.length} números que no están en el CRM
                </div>
                <p className="break-words font-mono text-[11px] text-muted-foreground">{result.unknown.join(" · ")}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResult(null)} className="h-9 rounded-full px-4 text-muted-foreground hover:bg-muted">
                Volver
              </button>
              <button
                type="button"
                onClick={() => void run(true)}
                disabled={busy || toMark === 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 font-medium text-white hover:bg-[#008069] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />} Confirmar {toMark}
              </button>
            </div>
          </>
        )}
      </div>
    </CrmModal>
  );
};

export default WhatsAppCommunityDetailClient;
