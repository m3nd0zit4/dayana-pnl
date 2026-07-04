"use client";

import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";

type Props = {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
};

/**
 * Lista dinámica pensada para muchos ítems:
 * Enter agrega el siguiente y lo enfoca; Backspace en un ítem vacío lo quita;
 * flechas reordenan.
 */
const StringListEditor = ({
  label,
  items,
  onChange,
  placeholder = "Nuevo ítem",
  addLabel = "Agregar",
}: Props) => {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    inputsRef.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  });

  const updateAt = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
    pendingFocus.current = Math.max(0, index - 1);
  };

  const insertAt = (index: number) => {
    const next = [...items];
    next.splice(index, 0, "");
    onChange(next);
    pendingFocus.current = index;
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    pendingFocus.current = target;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="crm-label mb-0">{label}</span>
        <button
          type="button"
          className="crm-btn-ghost text-xs"
          onClick={() => insertAt(items.length)}
        >
          <Plus className="mr-1 inline size-3.5" />
          {addLabel}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--crm-muted)]">Sin ítems. Agrega uno.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li key={index} className="flex items-center gap-1.5">
                <input
                  ref={(el) => {
                    inputsRef.current[index] = el;
                  }}
                  className="crm-input min-w-0 flex-1"
                  value={item}
                  placeholder={placeholder}
                  onChange={(e) => updateAt(index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      insertAt(index + 1);
                    } else if (
                      e.key === "Backspace" &&
                      item === "" &&
                      items.length > 1
                    ) {
                      e.preventDefault();
                      removeAt(index);
                    }
                  }}
                />
                <button
                  type="button"
                  className="crm-btn-icon size-7 shrink-0"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Subir ítem"
                  title="Subir"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="crm-btn-icon size-7 shrink-0"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label="Bajar ítem"
                  title="Bajar"
                >
                  <ChevronDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="crm-btn-icon size-7 shrink-0 text-red-700"
                  onClick={() => removeAt(index)}
                  aria-label="Quitar ítem"
                  title="Quitar"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[var(--crm-muted)]">
            Enter agrega el siguiente · Backspace en vacío lo quita
          </p>
        </>
      )}
    </div>
  );
};

export default StringListEditor;
