"use client";

import { Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Número que se puede borrar y reescribir sin que salte a 0 a medio escribir.
 * Solo avisa hacia fuera cuando hay un número.
 */
export const NumberField = ({
  id,
  value,
  onChange,
  min,
  max,
  suffix,
  disabled,
  invalid,
  className,
}: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) => {
  const [text, setText] = useState(String(value));
  // Si el valor cambia desde fuera, se refleja sin pisar lo que se escribe.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (Number(text) !== value) setText(String(value));
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(Number(e.target.value))) {
            onChange(Math.round(Number(e.target.value)));
          }
        }}
        className="w-24"
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
};

/**
 * Un texto largo plegado: se ve el principio y se abre con «Editar». Así la
 * pantalla no es un muro de texto y lo escrito sigue a la vista.
 */
export const ExpandableText = ({
  id,
  value,
  onChange,
  placeholder,
  emptyText,
  maxLength,
  rows = 6,
  extra,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText: string;
  maxLength: number;
  rows?: number;
  extra?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex w-full flex-col gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3 sm:flex-row sm:items-start">
        <p
          className={cn(
            "min-w-0 flex-1 line-clamp-2 text-sm whitespace-pre-wrap",
            !value && "text-muted-foreground italic"
          )}
        >
          {value || emptyText}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-controls={id}>
            <Pencil /> Editar
          </Button>
          {extra}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <Textarea
        id={id}
        autoFocus
        rows={rows}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Listo
        </Button>
        {extra}
        <span className="ml-auto text-xs text-muted-foreground">
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
};
