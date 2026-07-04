"use client";

import "@excalidraw/excalidraw/index.css";
import type { NotebookPageBackground } from "@prisma/client";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import NotebookBackground from "./NotebookBackground";
import NotebookToolbar, {
  PEN_PRESETS,
  presetFromAppState,
  type PenPresetKey,
} from "./NotebookToolbar";

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
  currentItemStrokeColor: appState.currentItemStrokeColor,
  currentItemOpacity: appState.currentItemOpacity,
});

const SAVE_DEBOUNCE_MS = 2000;
const PREVIEW_IDLE_MS = 5000;
const PREVIEW_MIN_INTERVAL_MS = 30_000;

// Same semantics as Excalidraw's getSceneVersion (sum of element versions),
// local to keep the lib out of this chunk's static imports.
const elementsFingerprint = (elements: readonly unknown[]) => {
  let sum = 0;
  for (const el of elements) {
    sum += (el as { version?: number }).version ?? 0;
  }
  return `${elements.length}:${sum}`;
};

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

  const snapshot = (canvasData ?? {}) as CanvasSnapshot;
  const savedStroke =
    typeof snapshot.appState?.currentItemStrokeWidth === "number"
      ? snapshot.appState.currentItemStrokeWidth
      : 2;
  const savedColor =
    typeof snapshot.appState?.currentItemStrokeColor === "string"
      ? snapshot.appState.currentItemStrokeColor
      : "#1e1e1e";
  const savedOpacity =
    typeof snapshot.appState?.currentItemOpacity === "number"
      ? snapshot.appState.currentItemOpacity
      : 100;

  const [tool, setTool] = useState("freedraw");
  const [pen, setPen] = useState<PenPresetKey>(() =>
    presetFromAppState(savedStroke, savedOpacity)
  );
  const [color, setColor] = useState(savedColor);

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
              currentItemStrokeColor: savedColor,
              currentItemOpacity: savedOpacity,
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
    [readOnly, savedStroke, savedColor, savedOpacity]
  );

  const applyPen = useCallback(
    (key: PenPresetKey) => {
      setPen(key);
      setTool("freedraw");
      const api = apiRef.current;
      if (!api) return;
      const preset = PEN_PRESETS[key];
      api.updateScene({
        appState: {
          currentItemStrokeWidth: preset.strokeWidth,
          currentItemOpacity: preset.opacity,
        },
      });
      api.setActiveTool({ type: "freedraw" });
    },
    []
  );

  const applyColor = useCallback((next: string) => {
    setColor(next);
    setTool("freedraw");
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({ appState: { currentItemStrokeColor: next } });
    api.setActiveTool({ type: "freedraw" });
  }, []);

  const toggleEraser = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const next = tool === "eraser" ? "freedraw" : "eraser";
    api.setActiveTool({ type: next });
    setTool(next);
  }, [tool]);

  // Excalidraw 0.18 no expone undo/redo imperativos; el atajo global sí
  // funciona porque handleKeyboardGlobally=true escucha en document.
  const dispatchHistory = useCallback((redo: boolean) => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        ctrlKey: true,
        shiftKey: redo,
        bubbles: true,
      })
    );
  }, []);

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
    if (fingerprint === baselineFingerprintRef.current) {
      dirtyRef.current = false;
      return;
    }

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

  const maybeExportPreview = useCallback(async () => {
    if (!blobConfigured || drawingRef.current) return;
    const api = apiRef.current;
    if (!api) return;
    const now = Date.now();
    if (now - lastPreviewAt.current < PREVIEW_MIN_INTERVAL_MS) return;
    lastPreviewAt.current = now;
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
        mimeType: "image/png",
      });
      await onPreview(pageIdRef.current, blob);
    } catch {
      /* preview is best-effort */
    }
  }, [onPreview, blobConfigured]);

  const schedulePreviewAfterIdle = useCallback(() => {
    if (!blobConfigured) return;
    if (previewIdleTimer.current) clearTimeout(previewIdleTimer.current);
    previewIdleTimer.current = setTimeout(() => {
      if (drawingRef.current) return;
      void maybeExportPreview();
    }, PREVIEW_IDLE_MS);
  }, [maybeExportPreview, blobConfigured]);

  const armSaveTimer = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      capturePendingFromApi();
      void flushSave().then((ok) => {
        if (ok) schedulePreviewAfterIdle();
      });
    }, SAVE_DEBOUNCE_MS);
  }, [capturePendingFromApi, flushSave, schedulePreviewAfterIdle]);

  // Cheap per-change check: no scene copies here — the snapshot is taken once,
  // when the debounce timer fires (and never while the pointer is down).
  const scheduleSave = useCallback(
    (elements: readonly unknown[]) => {
      if (readOnly || hydratingRef.current) return;

      const fingerprint = elementsFingerprint(elements);
      if (fingerprint === baselineFingerprintRef.current) return;

      dirtyRef.current = true;
      if (!drawingRef.current) armSaveTimer();
    },
    [readOnly, armSaveTimer]
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
              tools: { image: false },
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
              if (saveTimer.current) {
                clearTimeout(saveTimer.current);
                saveTimer.current = null;
              }
              if (previewIdleTimer.current) {
                clearTimeout(previewIdleTimer.current);
                previewIdleTimer.current = null;
              }
            }}
            onPointerUp={() => {
              drawingRef.current = false;
              if (dirtyRef.current) armSaveTimer();
            }}
            onChange={(elements, appState) => {
              scheduleSave(elements);
              // Mantiene la barra propia en sync con atajos de teclado (E, P…).
              const activeType = (
                appState as unknown as { activeTool?: { type?: string } }
              ).activeTool?.type;
              if (typeof activeType === "string") setTool(activeType);
            }}
          />
        </div>
        {!readOnly && (
          <NotebookToolbar
            tool={tool}
            pen={pen}
            color={color}
            onPen={applyPen}
            onColor={applyColor}
            onEraser={toggleEraser}
            onUndo={() => dispatchHistory(false)}
            onRedo={() => dispatchHistory(true)}
          />
        )}
      </div>
    </div>
  );
};

export type { CanvasSnapshot };
export default NotebookCanvasEditor;
