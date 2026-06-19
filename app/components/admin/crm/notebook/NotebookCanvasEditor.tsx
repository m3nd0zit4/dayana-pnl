"use client";

import "@excalidraw/excalidraw/index.css";
import type { NotebookPageBackground } from "@prisma/client";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import NotebookBackground from "./NotebookBackground";

type CanvasSnapshot = {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

type Props = {
  pageId: string;
  background: NotebookPageBackground;
  canvasData: unknown;
  readOnly: boolean;
  focusMode?: boolean;
  blobConfigured?: boolean;
  onSave: (pageId: string, data: CanvasSnapshot) => Promise<boolean>;
  onPreview: (pageId: string, blob: Blob) => Promise<void>;
};

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div className="crm-notebook-canvas-loading" aria-busy="true">
        <div className="crm-notebook-canvas-loading-inner">
          <span className="crm-notebook-canvas-loading-bar" />
          <p>Cargando lienzo…</p>
        </div>
      </div>
    ),
  }
);

const pickAppState = (appState: Record<string, unknown>) => ({
  viewBackgroundColor: appState.viewBackgroundColor,
  gridSize: appState.gridSize,
  zoom: appState.zoom,
  scrollX: appState.scrollX,
  scrollY: appState.scrollY,
  currentItemStrokeWidth: appState.currentItemStrokeWidth,
});

const SAVE_DEBOUNCE_MS = 1400;
const PREVIEW_IDLE_MS = 5000;
const PREVIEW_MIN_INTERVAL_MS = 30_000;

const elementsFingerprint = (elements: readonly unknown[]) => {
  if (elements.length === 0) return "0";
  const last = elements[elements.length - 1] as {
    id?: string;
    version?: number;
    versionNonce?: number;
  };
  return `${elements.length}:${last.id ?? ""}:${last.version ?? ""}:${last.versionNonce ?? ""}`;
};

const MINIMAL_TOOLS = {
  selection: true,
  hand: true,
  freedraw: true,
  eraser: true,
  rectangle: false,
  diamond: false,
  ellipse: false,
  arrow: false,
  line: false,
  text: false,
  image: false,
  frame: false,
  embeddable: false,
  laser: false,
} as const;

const NotebookCanvasEditor = ({
  pageId,
  background,
  canvasData,
  readOnly,
  focusMode = false,
  blobConfigured = true,
  onSave,
  onPreview,
}: Props) => {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewAt = useRef(0);
  const pendingRef = useRef<CanvasSnapshot | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageIdRef = useRef(pageId);
  const dirtyRef = useRef(false);
  const baselineFingerprintRef = useRef("");
  const hydratingRef = useRef(true);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const drawingRef = useRef(false);
  const lastElementsRef = useRef<readonly unknown[]>([]);
  const lastAppStateRef = useRef<Record<string, unknown>>({});
  const lastFilesRef = useRef<Record<string, unknown>>({});

  const snapshot = (canvasData ?? {}) as CanvasSnapshot;
  const savedStroke =
    typeof snapshot.appState?.currentItemStrokeWidth === "number"
      ? snapshot.appState.currentItemStrokeWidth
      : 2;

  const [initialData] = useState(() => {
    const elements = snapshot.elements ?? [];
    baselineFingerprintRef.current = elementsFingerprint(elements);
    return {
      elements,
      appState: {
        ...(snapshot.appState ?? {}),
        viewModeEnabled: readOnly,
        viewBackgroundColor: "transparent",
        currentItemStrokeWidth: savedStroke,
        penMode: true,
        zenModeEnabled: true,
      },
      files: snapshot.files ?? {},
    } as Record<string, unknown>;
  });

  pageIdRef.current = pageId;

  const captureApi = useCallback(
    (instance: ExcalidrawImperativeAPI) => {
      apiRef.current = instance;
      hydratingRef.current = true;

      window.setTimeout(() => {
        if (apiRef.current !== instance) return;

        if (!readOnly) {
          instance.setActiveTool({ type: "freedraw" });
          instance.updateScene({
            appState: {
              viewBackgroundColor: "transparent",
              currentItemStrokeWidth: savedStroke,
              penMode: true,
              zenModeEnabled: true,
              openSidebar: null,
            },
          });
        }

        requestAnimationFrame(() => {
          if (apiRef.current !== instance) return;
          window.dispatchEvent(new Event("resize"));
          window.setTimeout(() => {
            if (apiRef.current === instance) hydratingRef.current = false;
          }, 150);
        });
      }, 0);
    },
    [readOnly, savedStroke]
  );

  useEffect(
    () => () => {
      apiRef.current = null;
    },
    [pageId]
  );

  const capturePendingFromApi = useCallback(() => {
    const api = apiRef.current;
    if (!api || readOnly) return;

    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const fingerprint = elementsFingerprint(elements);
    if (fingerprint === baselineFingerprintRef.current) return;

    dirtyRef.current = true;
    pendingRef.current = {
      elements: [...elements],
      appState: pickAppState(appState as unknown as Record<string, unknown>),
      files: { ...files },
    };
  }, [readOnly]);

  const flushSave = useCallback(
    async (targetPageId?: string) => {
      if (!dirtyRef.current) return true;
      const pending = pendingRef.current;
      if (!pending) return true;
      const pageIdToSave = targetPageId ?? pageIdRef.current;
      pendingRef.current = null;
      const ok = await onSave(pageIdToSave, pending);
      if (ok) {
        dirtyRef.current = false;
        baselineFingerprintRef.current = elementsFingerprint(
          pending.elements ?? []
        );
      } else {
        pendingRef.current = pending;
      }
      return ok;
    },
    [onSave]
  );

  const maybeExportPreview = useCallback(
    async (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>
    ) => {
      if (!blobConfigured || drawingRef.current) return;
      const now = Date.now();
      if (now - lastPreviewAt.current < PREVIEW_MIN_INTERVAL_MS) return;
      lastPreviewAt.current = now;
      try {
        const { exportToBlob } = await import("@excalidraw/excalidraw");
        const blob = await exportToBlob({
          elements: elements as Parameters<typeof exportToBlob>[0]["elements"],
          appState: appState as Parameters<typeof exportToBlob>[0]["appState"],
          files: files as Parameters<typeof exportToBlob>[0]["files"],
          mimeType: "image/png",
        });
        await onPreview(pageIdRef.current, blob);
      } catch {
        /* preview is best-effort */
      }
    },
    [onPreview, blobConfigured]
  );

  const schedulePreviewAfterIdle = useCallback(() => {
    if (!blobConfigured) return;
    if (previewIdleTimer.current) clearTimeout(previewIdleTimer.current);
    previewIdleTimer.current = setTimeout(() => {
      if (drawingRef.current) return;
      void maybeExportPreview(
        lastElementsRef.current,
        lastAppStateRef.current,
        lastFilesRef.current
      );
    }, PREVIEW_IDLE_MS);
  }, [maybeExportPreview, blobConfigured]);

  const scheduleSave = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>
    ) => {
      if (readOnly || hydratingRef.current) return;

      const fingerprint = elementsFingerprint(elements);
      if (fingerprint === baselineFingerprintRef.current) return;

      lastElementsRef.current = elements;
      lastAppStateRef.current = appState;
      lastFilesRef.current = files as Record<string, unknown>;

      dirtyRef.current = true;
      pendingRef.current = {
        elements: [...elements],
        appState: pickAppState(appState),
        files: { ...files },
      };

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void flushSave().then((ok) => {
          if (ok) schedulePreviewAfterIdle();
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [readOnly, flushSave, schedulePreviewAfterIdle]
  );

  useEffect(() => {
    const mountedPageId = pageId;
    dirtyRef.current = false;
    pendingRef.current = null;
    hydratingRef.current = true;
    baselineFingerprintRef.current = elementsFingerprint(
      snapshot.elements ?? []
    );

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (previewIdleTimer.current) {
        clearTimeout(previewIdleTimer.current);
        previewIdleTimer.current = null;
      }
      capturePendingFromApi();
      void flushSave(mountedPageId);
    };
  }, [pageId, flushSave, capturePendingFromApi]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const notifyResize = () => window.dispatchEvent(new Event("resize"));
    const ro = new ResizeObserver(notifyResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageId]);

  return (
    <div className={`crm-notebook-canvas-stage${focusMode ? " is-focus" : ""}`}>
      <div className="crm-notebook-canvas-wrap" ref={wrapRef}>
        <NotebookBackground background={background} />
        <div className="crm-notebook-canvas-host crm-notebook-canvas-host--minimal">
          <Excalidraw
            key={pageId}
            excalidrawAPI={captureApi}
            initialData={initialData as never}
            langCode="es-ES"
            theme="light"
            gridModeEnabled={background === "GRID"}
            viewModeEnabled={readOnly}
            detectScroll={false}
            handleKeyboardGlobally={!readOnly}
            autoFocus={!readOnly}
            UIOptions={{
              welcomeScreen: false,
              tools: MINIMAL_TOOLS,
              canvasActions: {
                changeViewBackgroundColor: false,
                clearCanvas: !readOnly,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
              },
            }}
            onPointerDown={() => {
              drawingRef.current = true;
              if (previewIdleTimer.current) {
                clearTimeout(previewIdleTimer.current);
                previewIdleTimer.current = null;
              }
            }}
            onPointerUp={() => {
              drawingRef.current = false;
            }}
            onChange={(elements, appState, files) => {
              scheduleSave(
                elements,
                appState as unknown as Record<string, unknown>,
                files as Record<string, unknown>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
};

export type { CanvasSnapshot };
export default NotebookCanvasEditor;
