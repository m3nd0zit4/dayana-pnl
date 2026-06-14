"use client";

import type { NotebookPageBackground, NotebookPageKind } from "@prisma/client";
import { Minimize2, PanelLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NotebookPageDetail,
  NotebookPageListItem,
} from "@/lib/crm/contact-notebook";
import { useCrm } from "../CrmProvider";
import NotebookPageList from "./NotebookPageList";
import NotebookUploadViewer from "./NotebookUploadViewer";

const NotebookCanvasEditor = dynamic(() => import("./NotebookCanvasEditor"), {
  ssr: false,
  loading: () => (
    <div className="crm-notebook-canvas-loading" aria-busy="true">
      <div className="crm-notebook-canvas-loading-inner">
        <span className="crm-notebook-canvas-loading-bar" />
        <p>Cargando lienzo…</p>
      </div>
    </div>
  ),
});

type Props = {
  contactId: string;
  initialPageId?: string | null;
  createOnMount?: boolean;
  initialTherapySessionId?: string | null;
  focusMode?: boolean;
  patientLabel?: string;
  onExitFocus?: () => void;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

const BACKGROUND_OPTIONS: { value: NotebookPageBackground; label: string }[] = [
  { value: "BLANK", label: "Blanco" },
  { value: "RULED", label: "Rayado" },
  { value: "GRID", label: "Cuadrícula" },
];

const ContactNotebookPanel = ({
  contactId,
  initialPageId,
  createOnMount,
  initialTherapySessionId,
  focusMode = false,
  patientLabel,
  onExitFocus,
}: Props) => {
  const { canEditNotes, toast, confirm } = useCrm();
  const [pages, setPages] = useState<NotebookPageListItem[]>([]);
  const [activePage, setActivePage] = useState<NotebookPageDetail | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [blobUnavailable, setBlobUnavailable] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedCreate = useRef(false);
  const initRef = useRef<{ contactId: string; done: boolean }>({
    contactId: "",
    done: false,
  });
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pageCacheRef = useRef<Map<string, NotebookPageDetail>>(new Map());
  const savePageIdRef = useRef<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  savePageIdRef.current = activePageId;

  const loadPages = useCallback(async () => {
    const res = await fetch(`/api/admin/contacts/${contactId}/notebook/pages`);
    if (!res.ok) {
      throw new Error("load_failed");
    }
    const data = (await res.json()) as { pages?: NotebookPageListItem[] };
    return data.pages ?? [];
  }, [contactId]);

  const loadPage = useCallback(
    async (pageId: string) => {
      const res = await fetch(
        `/api/admin/contacts/${contactId}/notebook/pages/${pageId}`
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { page?: NotebookPageDetail };
      return data.page ?? null;
    },
    [contactId]
  );

  const selectPage = useCallback(
    async (pageId: string) => {
      if (pageId === activePageId && activePage) return;

      const cached = pageCacheRef.current.get(pageId);
      if (cached) {
        setActivePageId(pageId);
        setActivePage(cached);
        return;
      }

      setActivePageId(pageId);
      setPageLoading(true);
      const page = await loadPage(pageId);
      setPageLoading(false);
      if (page) {
        pageCacheRef.current.set(pageId, page);
        setActivePage(page);
      } else {
        setActivePage(null);
      }
    },
    [loadPage, activePageId, activePage]
  );

  const createPage = useCallback(
    async (opts?: {
      kind?: NotebookPageKind;
      therapySessionId?: string | null;
    }) => {
      const res = await fetch(`/api/admin/contacts/${contactId}/notebook/pages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: opts?.kind ?? "CANVAS",
          therapySessionId: opts?.therapySessionId ?? undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        if (err.error === "page_limit_reached") {
          toast("Límite de 200 hojas por paciente", "error");
        } else {
          toast("Error al crear hoja", "error");
        }
        return null;
      }
      const data = (await res.json()) as { page: NotebookPageDetail };
      pageCacheRef.current.set(data.page.id, data.page);
      const list = await loadPages();
      setPages(list);
      setActivePage(data.page);
      setActivePageId(data.page.id);
      return data.page;
    },
    [contactId, loadPages, toast]
  );

  useEffect(() => {
    if (initRef.current.contactId !== contactId) {
      initRef.current = { contactId, done: false };
      mountedCreate.current = false;
    }
    if (initRef.current.done) return;

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = await loadPages();
        if (cancelled) return;
        setPages(list);
        setLoading(false);

        if (createOnMount && !mountedCreate.current && canEditNotes) {
          mountedCreate.current = true;
          await createPage({ therapySessionId: initialTherapySessionId });
        } else if (initialPageId && list.some((p) => p.id === initialPageId)) {
          const page = await loadPage(initialPageId);
          if (cancelled || !page) return;
          pageCacheRef.current.set(page.id, page);
          setActivePageId(page.id);
          setActivePage(page);
        } else if (list.length > 0) {
          const firstId = list[0].id;
          const page = await loadPage(firstId);
          if (cancelled || !page) return;
          pageCacheRef.current.set(page.id, page);
          setActivePageId(firstId);
          setActivePage(page);
        }

        if (!cancelled) initRef.current.done = true;
      } catch {
        if (!cancelled) {
          setLoadError("No se pudo cargar el cuaderno. Recarga la página o revisa la conexión.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    contactId,
    loadPages,
    loadPage,
    createOnMount,
    initialPageId,
    initialTherapySessionId,
    canEditNotes,
    createPage,
  ]);

  const patchPage = async (
    pageId: string,
    patch: Record<string, unknown>
  ): Promise<NotebookPageDetail | null> => {
    const res = await fetch(
      `/api/admin/contacts/${contactId}/notebook/pages/${pageId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { page: NotebookPageDetail };
    pageCacheRef.current.set(data.page.id, data.page);
    return data.page;
  };

  const handleSaveCanvas = async (pageId: string, canvasData: unknown) => {
    const isActive = savePageIdRef.current === pageId;
    if (isActive) setSaveStatus("saving");
    const page = await patchPage(pageId, { canvasData });
    if (!page) {
      if (isActive) setSaveStatus("error");
      return false;
    }
    pageCacheRef.current.set(page.id, page);
    if (isActive) {
      setActivePage(page);
      setSaveStatus("saved");
    }
    setPages((prev) =>
      prev.map((p) =>
        p.id === page.id
          ? {
              ...p,
              updatedAt: page.updatedAt,
              previewUrl: page.previewUrl,
            }
          : p
      )
    );
    return true;
  };

  const handlePreview = async (pageId: string, blob: Blob) => {
    if (!savePageIdRef.current || savePageIdRef.current !== pageId) return;
    const form = new FormData();
    form.append("file", blob, "preview.png");
    const res = await fetch(
      `/api/admin/contacts/${contactId}/notebook/pages/${pageId}/preview`,
      { method: "POST", body: form }
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (err.error === "blob_not_configured") setBlobUnavailable(true);
      return;
    }
    const data = (await res.json()) as { page: NotebookPageDetail };
    pageCacheRef.current.set(data.page.id, data.page);
    if (savePageIdRef.current === data.page.id) {
      setActivePage(data.page);
    }
    setPages((prev) =>
      prev.map((p) =>
        p.id === data.page.id ? { ...p, previewUrl: data.page.previewUrl } : p
      )
    );
  };

  const handleTitleChange = (title: string) => {
    if (!activePageId || !activePage) return;
    setActivePage({ ...activePage, title });
    setPages((prev) =>
      prev.map((p) => (p.id === activePageId ? { ...p, title } : p))
    );
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      void patchPage(activePageId, { title });
    }, 600);
  };

  const handleBackgroundChange = (background: NotebookPageBackground) => {
    if (!activePageId || !activePage) return;
    setActivePage({ ...activePage, background });
    void patchPage(activePageId, { background });
  };

  const handleDelete = (pageId: string) => {
    if (deleting) return;
    confirm({
      title: "Eliminar hoja",
      message: "¿Eliminar esta hoja del cuaderno? No se puede deshacer.",
      onConfirm: async () => {
        setDeleting(true);
        if (titleTimer.current) clearTimeout(titleTimer.current);

        const wasActive = activePageId === pageId;
        const remaining = pages.filter((p) => p.id !== pageId);

        if (wasActive) {
          savePageIdRef.current = null;
          setActivePage(null);
          setActivePageId(null);
          setSaveStatus("idle");
          await new Promise((r) => setTimeout(r, 0));
        }

        pageCacheRef.current.delete(pageId);

        try {
          const res = await fetch(
            `/api/admin/contacts/${contactId}/notebook/pages/${pageId}`,
            { method: "DELETE" }
          );
          if (!res.ok) {
            toast("Error al eliminar", "error");
            if (wasActive) {
              const list = await loadPages();
              setPages(list);
              if (list.length > 0) await selectPage(list[0].id);
            }
            return;
          }

          setPages(remaining);
          if (wasActive) {
            if (remaining.length > 0) {
              await selectPage(remaining[0].id);
            }
          }
          toast("Hoja eliminada");
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  const handleMove = async (pageId: string, direction: "up" | "down") => {
    const idx = pages.findIndex((p) => p.id === pageId);
    if (idx < 0) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= pages.length) return;
    const ordered = [...pages];
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    const res = await fetch(`/api/admin/contacts/${contactId}/notebook/pages`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedIds: ordered.map((p) => p.id) }),
    });
    if (res.ok) {
      const data = (await res.json()) as { pages: NotebookPageListItem[] };
      setPages(data.pages);
    }
  };

  const createUploadPage = async (file: File) => {
    const page = await createPage({ kind: "UPLOAD" });
    if (!page) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `/api/admin/contacts/${contactId}/notebook/pages/${page.id}/upload`,
      { method: "POST", body: form }
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (err.error === "blob_not_configured") setBlobUnavailable(true);
      toast("Error al subir archivo", "error");
      return;
    }
    const data = (await res.json()) as { page: NotebookPageDetail };
    setActivePage(data.page);
    const list = await loadPages();
    setPages(list);
    toast("Hoja con archivo creada");
  };

  useEffect(() => {
    const mobileMq = window.matchMedia("(max-width: 767px)");
    const desktopMq = window.matchMedia("(min-width: 768px)");
    const syncLayout = () => {
      setIsMobile(mobileMq.matches);
      setSidebarOpen(!focusMode && desktopMq.matches);
    };
    syncLayout();
    mobileMq.addEventListener("change", syncLayout);
    desktopMq.addEventListener("change", syncLayout);
    return () => {
      mobileMq.removeEventListener("change", syncLayout);
      desktopMq.removeEventListener("change", syncLayout);
    };
  }, [focusMode]);

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleSelectPage = useCallback(
    (pageId: string) => {
      void selectPage(pageId);
      closeMobileSidebar();
    },
    [selectPage, closeMobileSidebar]
  );

  const saveLabel =
    saveStatus === "saving"
      ? "Guardando…"
      : saveStatus === "saved"
        ? "Guardado"
        : saveStatus === "error"
          ? "Error al guardar"
          : "";

  if (loading) {
    return (
      <section className="crm-notebook-panel crm-notebook-panel--loading">
        <div className="crm-notebook-canvas-loading" aria-busy="true">
          <div className="crm-notebook-canvas-loading-inner">
            <span className="crm-notebook-canvas-loading-bar" />
            <p>Cargando cuaderno…</p>
          </div>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="crm-notebook-panel p-4">
        <p className="text-sm text-red-800">{loadError}</p>
        <button
          type="button"
          className="crm-btn-secondary mt-3 text-xs"
          onClick={() => window.location.reload()}
        >
          Recargar
        </button>
      </section>
    );
  }

  return (
    <section
      className={`crm-notebook-panel${focusMode ? " crm-notebook-panel--focus" : ""}`}
    >
      <div className="crm-notebook-layout">
        {isMobile && sidebarOpen && (
          <button
            type="button"
            className="crm-notebook-sidebar-backdrop"
            aria-label="Cerrar lista de hojas"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {sidebarOpen && (
          <NotebookPageList
            pages={pages}
            activePageId={activePageId}
            canEdit={canEditNotes}
            contactId={contactId}
            onSelect={handleSelectPage}
            onCreate={() => void createPage()}
            onDelete={handleDelete}
            onMove={(id, dir) => void handleMove(id, dir)}
          />
        )}

        <div className="crm-notebook-main">
          {activePage ? (
            <>
              <div className="crm-notebook-toolbar">
                <button
                  type="button"
                  className="crm-btn-icon size-7 shrink-0"
                  aria-label={sidebarOpen ? "Ocultar hojas" : "Mostrar hojas"}
                  title={sidebarOpen ? "Ocultar hojas" : "Mostrar hojas"}
                  onClick={() => setSidebarOpen((o) => !o)}
                >
                  <PanelLeft className="size-3.5" />
                </button>
                {focusMode && patientLabel && (
                  <span className="crm-notebook-patient-label truncate">
                    {patientLabel}
                  </span>
                )}
                <input
                  className="crm-notebook-title-input"
                  value={activePage.title}
                  readOnly={!canEditNotes}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  aria-label="Título de la hoja"
                />
                <div className="crm-notebook-toolbar-actions">
                  {canEditNotes && activePage.kind === "CANVAS" && (
                    <select
                      className="crm-select crm-notebook-select"
                      value={activePage.background}
                      onChange={(e) =>
                        handleBackgroundChange(
                          e.target.value as NotebookPageBackground
                        )
                      }
                      aria-label="Fondo de la hoja"
                    >
                      {BACKGROUND_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {saveLabel && (
                    <span className="crm-notebook-save-status">{saveLabel}</span>
                  )}
                  {canEditNotes && (
                    <button
                      type="button"
                      className="crm-btn-secondary text-xs"
                      onClick={() => void createPage()}
                    >
                      Nueva hoja
                    </button>
                  )}
                  {canEditNotes && !focusMode && (
                    <>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void createUploadPage(f);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        className="crm-btn-ghost text-xs"
                        onClick={() => uploadInputRef.current?.click()}
                      >
                        Subir PDF
                      </button>
                    </>
                  )}
                  {focusMode && onExitFocus && (
                    <button
                      type="button"
                      className="crm-btn-icon size-7 shrink-0"
                      aria-label="Salir del modo enfoque"
                      title="Salir (Esc)"
                      onClick={onExitFocus}
                    >
                      <Minimize2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {blobUnavailable && (
                <p className="crm-notebook-blob-warn">
                  Las miniaturas y subidas requieren Vercel Blob conectado al
                  proyecto. En local ejecuta{" "}
                  <code>bun run env:pull</code> (o añade{" "}
                  <code>BLOB_READ_WRITE_TOKEN</code>). El dibujo se guarda igual
                  en la base de datos.
                </p>
              )}

              {pageLoading ? (
                <div className="crm-notebook-canvas-loading" aria-busy="true">
                  <div className="crm-notebook-canvas-loading-inner">
                    <span className="crm-notebook-canvas-loading-bar" />
                    <p>Cargando hoja…</p>
                  </div>
                </div>
              ) : activePage.kind === "CANVAS" ? (
                <NotebookCanvasEditor
                  key={activePage.id}
                  pageId={activePage.id}
                  background={activePage.background}
                  canvasData={activePage.canvasData}
                  readOnly={!canEditNotes}
                  focusMode={focusMode}
                  onSave={handleSaveCanvas}
                  onPreview={handlePreview}
                />
              ) : (
                <NotebookUploadViewer
                  contactId={contactId}
                  pageId={activePage.id}
                  mime={activePage.attachmentMime}
                  name={activePage.attachmentName}
                  canEdit={canEditNotes}
                  onUploaded={() => void selectPage(activePage.id)}
                />
              )}
            </>
          ) : (
            <div className="crm-notebook-empty">
              <p className="text-sm font-medium text-[var(--crm-foreground)]">
                {canEditNotes
                  ? "Aún no hay hojas en este cuaderno"
                  : "Sin hojas en este cuaderno"}
              </p>
              {canEditNotes && (
                <button
                  type="button"
                  className="crm-btn-primary mt-4 px-5 py-2 text-xs"
                  onClick={() => void createPage()}
                >
                  Crear primera hoja
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default ContactNotebookPanel;
