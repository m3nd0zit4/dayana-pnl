"use client";

import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { WorkshopScheduleSlot } from "@/lib/workshops";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";

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
        <Label>{label}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={addItem}>
          <Plus className="inline" />
          Agregar bloque
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin bloques en el cronograma.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li
                key={index}
                className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.4fr_auto]"
              >
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Inicio
                  </Label>
                  <Input
                    ref={(el) => {
                      startRefs.current[index] = el;
                    }}
                    type="time"
                    value={item.startTime}
                    onChange={(e) => updateAt(index, { startTime: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Fin
                  </Label>
                  <Input
                    type="time"
                    value={item.endTime}
                    onChange={(e) => updateAt(index, { endTime: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Actividad
                  </Label>
                  <Input
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Subir bloque"
                    title="Subir"
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label="Bajar bloque"
                    title="Bajar"
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive"
                    onClick={() => removeAt(index)}
                    aria-label="Quitar bloque"
                    title="Quitar"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Enter en Actividad agrega el siguiente bloque · el nuevo arranca donde
            terminó el anterior
          </p>
        </>
      )}
    </div>
  );
};

export default ScheduleSlotEditor;
