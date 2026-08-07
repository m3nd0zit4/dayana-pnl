"use client";

import type { NotebookPageBackground } from "@prisma/client";
import { Minimize2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NotebookPageDetail } from "@/lib/crm/contact-notebook";
import { useCrm } from "../CrmProvider";

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
  focusMode = false,
  patientLabel,
  onExitFocus,
}: Props) => {
  const { canEditNotes } = useCrm();
  const [page, setPage] = useState<NotebookPageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [blobConfigured, setBlobConfigured] = useState(true);
  const initRef = useRef<{ contactId: string; done: boolean }>({
    contactId: "",
    done: false,
  });
  const savePageIdRef = useRef<string | null>(null);

  savePageIdRef.current = page?.id ?? null;

  const loadCanvas = useCallback(async () => {
    const res = await fetch(`/api/admin/contacts/${contactId}/notebook/pages`, {
      method: "POST",
    });
    if (!res.ok) {
      if (res.status === 403) throw new Error("forbidden");
      if (res.status === 503) throw new Error("blob_not_configured");
      throw new Error("load_failed");
    }
    const data = (await res.json()) as {
      page?: NotebookPageDetail;
      blobConfigured?: boolean;
    };
    if (typeof data.blobConfigured === "boolean") {
      setBlobConfigured(data.blobConfigured);
    }
    return data.page ?? null;
  }, [contactId]);

  useEffect(() => {
    if (initRef.current.contactId !== contactId) {
      initRef.current = { contactId, done: false };
    }
    if (initRef.current.done) return;

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const listRes = await fetch(
          `/api/admin/contacts/${contactId}/notebook/pages`
        );
        if (!listRes.ok) throw new Error("load_failed");
        const listData = (await listRes.json()) as {
          pages?: { id: string }[];
          blobConfigured?: boolean;
        };
        const blobIsConfigured = listData.blobConfigured !== false;
        setBlobConfigured(blobIsConfigured);

        if (!blobIsConfigured) {
          if (cancelled) return;
          setPage(null);
          setLoading(false);
          initRef.current.done = true;
          return;
        }

        let canvasPage: NotebookPageDetail | null = null;
        if (listData.pages?.[0]) {
          const detailRes = await fetch(
            `/api/admin/contacts/${contactId}/notebook/pages/${listData.pages[0].id}`
          );
          if (detailRes.ok) {
            const detail = (await detailRes.json()) as {
              page?: NotebookPageDetail;
            };
            canvasPage = detail.page ?? null;
          }
        } else if (canEditNotes) {
          canvasPage = await loadCanvas();
        }

        if (cancelled) return;
        setPage(canvasPage);
        setLoading(false);
        initRef.current.done = true;
      } catch {
        if (!cancelled) {
          setLoadError(
            "No se pudo cargar el cuaderno. Recarga la página o revisa la conexión."
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contactId, canEditNotes, loadCanvas]);

  const patchPage = async (
    pageId: string,
    patch: Record<string, unknown>
  ): Promise<boolean> => {
    const res = await fetch(
      `/api/admin/contacts/${contactId}/notebook/pages/${pageId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    return res.ok;
  };

  // Deliberately does not touch `page` state: echoing the saved scene back
  // into React would re-render the editor mid-drawing.
  const handleSaveCanvas = async (pageId: string, canvasData: unknown) => {
    const isActive = savePageIdRef.current === pageId;
    if (isActive) setSaveStatus("saving");
    const ok = await patchPage(pageId, { canvasData });
    if (isActive) setSaveStatus(ok ? "saved" : "error");
    return ok;
  };

  const handlePreview = async (pageId: string, blob: Blob) => {
    if (!blobConfigured) return;
    if (!savePageIdRef.current || savePageIdRef.current !== pageId) return;
    const form = new FormData();
    form.append("file", blob, "preview.png");
    await fetch(
      `/api/admin/contacts/${contactId}/notebook/pages/${pageId}/preview`,
      { method: "POST", body: form }
    );
  };

  const handleBackgroundChange = (background: NotebookPageBackground) => {
    if (!page) return;
    setPage({ ...page, background });
    void patchPage(page.id, { background });
  };

  const saveLabel =
    saveStatus === "saving"
      ? "Guardando…"
      : saveStatus === "saved"
        ? "Guardado"
        : saveStatus === "error"
          ? "Error al guardar"
          : "";

  const blobWarnMessage =
    process.env.NODE_ENV === "production"
      ? "Conecta Vercel Blob Storage al proyecto en el dashboard de Vercel para activar el cuaderno."
      : "Conecta Vercel Blob en local (o ejecuta bun run env:pull) para activar el cuaderno.";

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

  if (!blobConfigured) {
    return (
      <section className="crm-notebook-panel">
        <div className="crm-notebook-empty">
          <p className="text-sm font-medium text-foreground">
            Cuaderno clínico no configurado
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {blobWarnMessage}
          </p>
        </div>
      </section>
    );
  }

  if (!page) {
    return (
      <section className="crm-notebook-panel">
        <div className="crm-notebook-empty">
          <p className="text-sm font-medium text-foreground">
            Sin permiso para crear el cuaderno
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`crm-notebook-panel${focusMode ? " crm-notebook-panel--focus" : ""}`}
    >
      <div className="crm-notebook-layout crm-notebook-layout--single">
        <div className="crm-notebook-main">
          <div className="crm-notebook-toolbar">
            {focusMode && patientLabel && (
              <span className="crm-notebook-patient-label truncate">
                {patientLabel}
              </span>
            )}
            <span className="crm-notebook-title-static">Cuaderno clínico</span>
            <div className="crm-notebook-toolbar-actions">
              {canEditNotes && (
                <select
                  className="crm-select crm-notebook-select"
                  value={page.background}
                  onChange={(e) =>
                    handleBackgroundChange(
                      e.target.value as NotebookPageBackground
                    )
                  }
                  aria-label="Fondo del lienzo"
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

          <NotebookCanvasEditor
            pageId={page.id}
            background={page.background}
            canvasData={page.canvasData}
            readOnly={!canEditNotes}
            focusMode={focusMode}
            blobConfigured={blobConfigured}
            onSave={handleSaveCanvas}
            onPreview={handlePreview}
          />
        </div>
      </div>
    </section>
  );
};

export default ContactNotebookPanel;
