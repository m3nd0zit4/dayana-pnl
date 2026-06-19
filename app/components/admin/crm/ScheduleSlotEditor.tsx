"use client";

import type { WorkshopScheduleSlot } from "@/lib/workshops";

type Props = {
  label: string;
  items: WorkshopScheduleSlot[];
  onChange: (items: WorkshopScheduleSlot[]) => void;
};

const ScheduleSlotEditor = ({ label, items, onChange }: Props) => {
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
    onChange([...items, { startTime: "", endTime: "", title: "" }]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="crm-label mb-0">{label}</span>
        <button type="button" className="crm-btn-ghost text-xs" onClick={addItem}>
          Agregar bloque
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--crm-muted)]">Sin bloques en el cronograma.</p>
      ) : (
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
                  required
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="crm-btn-secondary crm-btn-compact w-full sm:w-auto"
                  onClick={() => removeAt(index)}
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ScheduleSlotEditor;
