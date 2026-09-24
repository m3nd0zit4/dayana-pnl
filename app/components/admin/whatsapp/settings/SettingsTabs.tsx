"use client";

import type { LucideIcon } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

export type SettingsTabItem<T extends string> = { id: T; label: string; icon: LucideIcon };

/**
 * Pestañas de Ajustes de WhatsApp. En el teléfono se deslizan de lado; con el
 * teclado, las flechas cambian de pestaña.
 */
const SettingsTabs = <T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: SettingsTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
}) => {
  const list = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const index = tabs.findIndex((t) => t.id === value);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    onChange(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div
      ref={list}
      role="tablist"
      aria-label="Secciones de ajustes"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(1);
        if (e.key === "ArrowLeft") move(-1);
      }}
    >
      {tabs.map((t) => {
        const on = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            id={`wa-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`wa-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]",
              on
                ? "border-[#00a884] bg-[#00a884] text-white hover:bg-[#008069]"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t.label}
          </button>
        );
      })}
    </div>
  );
};

export default SettingsTabs;
