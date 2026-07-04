"use client";

import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { WorkshopScheduleSlot } from "@/lib/workshops";

type Props = {
  label: string;
  items: WorkshopScheduleSlot[];
  onChange: (items: WorkshopScheduleSlot[]) => void;
};

/**
 * Cronograma dinámico pensado para muchos bloques: el bloque nuevo arranca
 * donde terminó el anterior, Enter en "Actividad" agrega el siguiente y
 * las flechas reordenan.
 */
const ScheduleSlotEditor = ({ label, items, onChange }: Props) => {
  const startRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    startRefs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  });

  const updateAt = (index: number, patch: Partial<WorkshopScheduleSlot>) => {
    const next = items.map((item, i) =>
      i === index ? { ...item, ...patch } : item
    );
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    const prevEnd = items[items.length - 1]?.endTime ?? "";
    onChange([...items, { startTime: prevEnd, endTime: "", title: "" }]);
    pendingFocus.current = items.length;
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="crm-label mb-0">{label}</span>
        <button type="button" className="crm-btn-ghost text-xs" onClick={addItem}>
          <Plus className="mr-1 inline size-3.5" />
          Agregar bloque
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--crm-muted)]">Sin bloques en el cronograma.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li
                key={index}
                className="grid gap-2 rounded-lg border border-[var(--crm-border)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.4fr_auto]"
              >
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--crm-muted)]">
                    Inicio
                  </label>
                  <input
                    ref={(el) => {
                      startRefs.current[index] = el;
                    }}
                    type="time"
                    className="crm-input"
                    value={item.startTime}
                    onChange={(e) => updateAt(index, { startTime: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--crm-muted)]">
                    Fin
                  </label>
                  <input
                    type="time"
                    className="crm-input"
                    value={item.endTime}
                    onChange={(e) => updateAt(index, { endTime: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--crm-muted)]">
                    Actividad
                  </label>
                  <input
                    className="crm-input"
                    value={item.title}
                    placeholder="Apertura y bienvenida"
                    onChange={(e) => updateAt(index, { title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addItem();
                      }
                    }}
                    required
                  />
                </div>
                <div className="flex items-end gap-1.5">
                  <button
                    type="button"
                    className="crm-btn-icon size-7 shrink-0"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Subir bloque"
                    title="Subir"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="crm-btn-icon size-7 shrink-0"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label="Bajar bloque"
                    title="Bajar"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="crm-btn-icon size-7 shrink-0 text-red-700"
                    onClick={() => removeAt(index)}
                    aria-label="Quitar bloque"
                    title="Quitar"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[var(--crm-muted)]">
            Enter en Actividad agrega el siguiente bloque · el nuevo arranca donde
            terminó el anterior
          </p>
        </>
      )}
    </div>
  );
};

export default ScheduleSlotEditor;
