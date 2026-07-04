"use client";

import { Eraser, Highlighter, Redo2, Undo2 } from "lucide-react";

export type PenPresetKey = "fine" | "medium" | "thick" | "highlighter";

export const PEN_PRESETS: Record<
  PenPresetKey,
  { label: string; strokeWidth: number; opacity: number }
> = {
  fine: { label: "Fino", strokeWidth: 1, opacity: 100 },
  medium: { label: "Medio", strokeWidth: 2, opacity: 100 },
  thick: { label: "Grueso", strokeWidth: 4, opacity: 100 },
  highlighter: { label: "Resaltador", strokeWidth: 8, opacity: 40 },
};

export const PEN_COLORS = [
  "#1e1e1e",
  "#1971c2",
  "#e03131",
  "#2f9e44",
  "#f08c00",
  "#9c36b5",
] as const;

/** Deriva el preset guardado a partir de grosor + opacidad. */
export const presetFromAppState = (
  strokeWidth: unknown,
  opacity: unknown
): PenPresetKey => {
  const width = typeof strokeWidth === "number" ? strokeWidth : 2;
  const alpha = typeof opacity === "number" ? opacity : 100;
  if (alpha < 100) return "highlighter";
  if (width >= 4) return "thick";
  if (width >= 2) return "medium";
  return "fine";
};

type Props = {
  tool: string;
  pen: PenPresetKey;
  color: string;
  onPen: (pen: PenPresetKey) => void;
  onColor: (color: string) => void;
  onEraser: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

const PEN_DOT_SIZE: Record<PenPresetKey, number> = {
  fine: 4,
  medium: 7,
  thick: 10,
  highlighter: 12,
};

const NotebookToolbar = ({
  tool,
  pen,
  color,
  onPen,
  onColor,
  onEraser,
  onUndo,
  onRedo,
}: Props) => {
  const penActive = tool === "freedraw";

  return (
    <div className="crm-notebook-tools" role="toolbar" aria-label="Herramientas de dibujo">
      <div className="crm-notebook-tools-group">
        {(Object.keys(PEN_PRESETS) as PenPresetKey[]).map((key) => {
          const preset = PEN_PRESETS[key];
          const active = penActive && pen === key;
          return (
            <button
              key={key}
              type="button"
              className={`crm-notebook-tool-btn${active ? " is-active" : ""}`}
              title={preset.label}
              aria-label={`Lápiz ${preset.label.toLowerCase()}`}
              aria-pressed={active}
              onClick={() => onPen(key)}
            >
              {key === "highlighter" ? (
                <Highlighter className="size-4" />
              ) : (
                <span
                  className="crm-notebook-pen-dot"
                  style={{
                    width: PEN_DOT_SIZE[key],
                    height: PEN_DOT_SIZE[key],
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      <span className="crm-notebook-tools-sep" />

      <div className="crm-notebook-tools-group">
        {PEN_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`crm-notebook-color-btn${
              color.toLowerCase() === swatch ? " is-active" : ""
            }`}
            style={{ backgroundColor: swatch }}
            title={swatch}
            aria-label={`Color ${swatch}`}
            aria-pressed={color.toLowerCase() === swatch}
            onClick={() => onColor(swatch)}
          />
        ))}
      </div>

      <span className="crm-notebook-tools-sep" />

      <div className="crm-notebook-tools-group">
        <button
          type="button"
          className={`crm-notebook-tool-btn${tool === "eraser" ? " is-active" : ""}`}
          title="Borrador (E)"
          aria-label="Borrador"
          aria-pressed={tool === "eraser"}
          onClick={onEraser}
        >
          <Eraser className="size-4" />
        </button>
        <button
          type="button"
          className="crm-notebook-tool-btn"
          title="Deshacer (Ctrl+Z)"
          aria-label="Deshacer"
          onClick={onUndo}
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          className="crm-notebook-tool-btn"
          title="Rehacer (Ctrl+Shift+Z)"
          aria-label="Rehacer"
          onClick={onRedo}
        >
          <Redo2 className="size-4" />
        </button>
      </div>
    </div>
  );
};

export default NotebookToolbar;
