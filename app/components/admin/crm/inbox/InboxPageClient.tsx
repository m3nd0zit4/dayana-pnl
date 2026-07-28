"use client";

import {
  AtSign,
  ArrowLeft,
  MessageCircle,
  MessagesSquare,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Skeleton } from "@/app/components/ui/skeleton";
import CrmPageShell from "../CrmPageShell";
import { useCrm } from "../CrmProvider";
import ConversationThread from "./ConversationThread";
import {
  CHANNEL_LABEL,
  EMPTY_FILTERS,
  humanizeInboxError,
  type ConversationDetailView,
  type ConversationListItem,
  type InboxChannel,
  type InboxFilters,
  type StaffRef,
} from "./types";

type Props = {
  initialItems: ConversationListItem[];
  initialCursor: string | null;
  initialSelectedId: string | null;
  /** Hilo ya resuelto en el servidor cuando se entra por enlace profundo. */
  initialDetail: ConversationDetailView | null;
  staff: StaffRef[];
};

const CHANNEL_ICON: Record<InboxChannel, typeof MessageCircle> = {
  WHATSAPP: MessageCircle,
  MESSENGER: MessagesSquare,
  INSTAGRAM: AtSign,
};

const CHANNEL_TABS: (InboxChannel | "ALL")[] = [
  "ALL",
  "WHATSAPP",
  "INSTAGRAM",
  "MESSENGER",
];

const participantLabel = (item: ConversationListItem): string =>
  item.contact?.displayName ??
  (item.contact
    ? `${item.contact.firstName} ${item.contact.lastName ?? ""}`.trim()
    : null) ??
  item.participantName ??
  item.participantHandle ??
  item.externalThreadId;

const buildQuery = (filters: InboxFilters, cursor?: string | null): string => {
  const params = new URLSearchParams();
  if (filters.channel !== "ALL") params.set("channel", filters.channel);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.assignedToMe) params.set("assigned", "me");
  if (filters.unlinkedOnly) params.set("unlinked", "1");
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (cursor) params.set("cursor", cursor);
  return params.toString();
};

const InboxPageClient = ({
  initialItems,
  initialCursor,
  initialSelectedId,
  initialDetail,
  staff,
}: Props) => {
  const { canWrite, toast } = useCrm();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [filters, setFilters] = useState<InboxFilters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [detail, setDetail] = useState<ConversationDetailView | null>(
    initialDetail
  );
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // El stream solo debe abrirse una vez. Si `selectedId` entrara en las
  // dependencias del efecto, cada clic cerraría el EventSource y abriría otra
  // invocación de 300 s en Fluid.
  const selectedIdRef = useRef<string | null>(initialSelectedId);

  const loadDetail = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/admin/inbox/${id}`, { cache: "no-store" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast(humanizeInboxError(data.error), "error");
          return;
        }
        const data = (await res.json()) as ConversationDetailView;
        setDetail(data);
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, unreadCount: 0 } : item
          )
        );
      } catch {
        toast("No se pudo abrir la conversación. Revisa tu conexión.", "error");
      } finally {
        setLoadingDetail(false);
      }
    },
    [toast]
  );

  const loadList = useCallback(
    async (next: InboxFilters) => {
      setLoadingList(true);
      try {
        const res = await fetch(`/api/admin/inbox?${buildQuery(next)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          toast("No se pudo cargar la bandeja.", "error");
          return;
        }
        const data = (await res.json()) as {
          items: ConversationListItem[];
          nextCursor: string | null;
        };
        setItems(data.items);
        setCursor(data.nextCursor);
      } catch {
        toast("No se pudo cargar la bandeja. Revisa tu conexión.", "error");
      } finally {
        setLoadingList(false);
      }
    },
    [toast]
  );

  /** Añade la página siguiente; antes esto recargaba la primera y se perdía. */
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/admin/inbox?${buildQuery(filters, cursor)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: ConversationListItem[];
        nextCursor: string | null;
      };
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
    } catch {
      toast("No se pudieron cargar más conversaciones.", "error");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, filters, loadingMore, toast]);

  const applyFilters = (patch: Partial<InboxFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    void loadList(next);
  };

  const selectThread = useCallback(
    (id: string) => {
      setSelectedId(id);
      // El ref se actualiza aquí, no en render: el stream lo lee para saber qué
      // hilo recargar sin tener que reabrirse en cada clic.
      selectedIdRef.current = id;
      void loadDetail(id);
      // La URL sigue al hilo abierto para que se pueda compartir y para que el
      // enlace de la campana caiga en el sitio correcto.
      window.history.replaceState(null, "", `/admin/inbox/${id}`);
    },
    [loadDetail]
  );

  /** Un solo EventSource durante toda la vida del componente. */
  useEffect(() => {
    const source = new EventSource("/api/admin/inbox/stream");
    source.onmessage = () => {
      void loadList(filters);
      const open = selectedIdRef.current;
      if (open) void loadDetail(open);
    };
    // Un error de red no cierra nada: el navegador reconecta solo con el
    // `retry` que manda el servidor.
    source.onerror = () => undefined;
    return () => source.close();
    // Deliberadamente sin `selectedId` ni `filters` en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlinkedCount = useMemo(
    () => items.filter((item) => !item.contact).length,
    [items]
  );

  return (
    <CrmPageShell>
      <header className="pb-4">
        <h1 className="text-xl font-semibold">Bandeja de entrada</h1>
        <p className="text-sm text-muted-foreground">
          WhatsApp, Instagram y Messenger en un solo lugar.
        </p>
      </header>

      {/* Filtros */}
      <div className="space-y-2 pb-4">
        <div
          role="tablist"
          aria-label="Filtrar por canal"
          className="flex flex-wrap gap-2"
        >
          {CHANNEL_TABS.map((value) => (
            <Button
              key={value}
              role="tab"
              aria-selected={filters.channel === value}
              size="sm"
              variant={filters.channel === value ? "default" : "outline"}
              onClick={() => applyFilters({ channel: value })}
            >
              {value === "ALL" ? "Todos" : CHANNEL_LABEL[value]}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="relative">
            <Search
              className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters({});
              }}
              onBlur={() => applyFilters({})}
              placeholder="Buscar…"
              aria-label="Buscar conversaciones"
              className="w-48 pl-8"
            />
          </span>
          <Button
            size="sm"
            variant={filters.assignedToMe ? "default" : "outline"}
            aria-pressed={filters.assignedToMe}
            onClick={() => applyFilters({ assignedToMe: !filters.assignedToMe })}
          >
            Asignadas a mí
          </Button>
          <Button
            size="sm"
            variant={filters.unlinkedOnly ? "default" : "outline"}
            aria-pressed={filters.unlinkedOnly}
            onClick={() => applyFilters({ unlinkedOnly: !filters.unlinkedOnly })}
          >
            Sin vincular{unlinkedCount > 0 ? ` (${unlinkedCount})` : ""}
          </Button>
          <Button
            size="sm"
            variant={filters.status === "CLOSED" ? "default" : "outline"}
            aria-pressed={filters.status === "CLOSED"}
            onClick={() =>
              applyFilters({ status: filters.status === "CLOSED" ? "ALL" : "CLOSED" })
            }
          >
            Cerradas
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Lista — se oculta en móvil cuando hay un hilo abierto. */}
        <div
          className={`max-h-[70vh] space-y-1 overflow-y-auto rounded-lg border p-2 ${
            detail ? "hidden lg:block" : ""
          }`}
        >
          {loadingList &&
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}

          {!loadingList && items.length === 0 && (
            <div className="space-y-2 p-4 text-sm">
              <p className="font-medium">No hay conversaciones</p>
              <p className="text-muted-foreground">
                {filters.channel !== "ALL" ||
                filters.search ||
                filters.assignedToMe ||
                filters.unlinkedOnly
                  ? "Ningún hilo coincide con estos filtros."
                  : "Cuando alguien escriba por WhatsApp, Instagram o Messenger, aparecerá aquí."}
              </p>
            </div>
          )}

          {!loadingList &&
            items.map((item) => {
              const Icon = CHANNEL_ICON[item.channel];
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={selectedId === item.id}
                  onClick={() => selectThread(item.id)}
                  className={`flex w-full flex-col gap-1 rounded-md p-3 text-left transition-colors hover:bg-muted ${
                    selectedId === item.id ? "bg-muted" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                    <span className="truncate text-sm font-medium">
                      {participantLabel(item)}
                    </span>
                    {item.unreadCount > 0 && (
                      <Badge
                        className="ml-auto"
                        aria-label={`${item.unreadCount} sin leer`}
                      >
                        {item.unreadCount}
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.lastMessage?.body ?? "(adjunto)"}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {!item.contact && (
                      <span className="text-amber-600 dark:text-amber-500">
                        Sin vincular
                      </span>
                    )}
                    {item.assignedStaff && (
                      <span className="text-muted-foreground">
                        {item.assignedStaff.displayName}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}

          {cursor && !loadingList && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Cargando…" : "Cargar más"}
            </Button>
          )}
        </div>

        {/* Hilo */}
        <div className={detail ? "" : "hidden lg:block"}>
          {!detail && !loadingDetail && (
            <p className="rounded-lg border p-6 text-sm text-muted-foreground">
              Elige una conversación.
            </p>
          )}

          {loadingDetail && !detail && (
            <div className="space-y-3 rounded-lg border p-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-3/4" />
            </div>
          )}

          {detail && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="mb-2 lg:hidden"
                onClick={() => {
                  setDetail(null);
                  setSelectedId(null);
                  window.history.replaceState(null, "", "/admin/inbox");
                }}
              >
                <ArrowLeft className="size-4" aria-hidden />
                Volver
              </Button>

              <ConversationThread
                key={detail.id}
                detail={detail}
                staff={staff}
                canWrite={canWrite}
                busy={loadingDetail}
                onRefresh={() => {
                  void loadDetail(detail.id);
                  void loadList(filters);
                }}
              />
            </>
          )}
        </div>
      </div>
    </CrmPageShell>
  );
};

export default InboxPageClient;
