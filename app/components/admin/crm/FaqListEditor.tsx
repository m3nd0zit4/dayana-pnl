"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import type { FreeWebinarFaqItem } from "@/lib/crm/free-webinar-publish";

type Props = {
  label: string;
  items: FreeWebinarFaqItem[];
  onChange: (items: FreeWebinarFaqItem[]) => void;
};

const FaqListEditor = ({ label, items, onChange }: Props) => {
  const updateAt = (index: number, patch: Partial<FreeWebinarFaqItem>) => {
    const next = items.map((item, i) =>
      i === index ? { ...item, ...patch } : item
    );
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...items, { q: "", a: "" }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={add}>
          <Plus className="inline" />
          Agregar pregunta
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin preguntas. Agrega una si quieres FAQ en la landing.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item, index) => (
            <li
              key={index}
              className="space-y-2 rounded-xl border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  #{index + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-destructive"
                  onClick={() => removeAt(index)}
                  aria-label="Quitar pregunta"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`faq-q-${index}`}>Pregunta</Label>
                <Input
                  id={`faq-q-${index}`}
                  value={item.q}
                  onChange={(e) => updateAt(index, { q: e.target.value })}
                  placeholder="¿El webinar tiene costo?"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`faq-a-${index}`}>Respuesta</Label>
                <Textarea
                  id={`faq-a-${index}`}
                  value={item.a}
                  onChange={(e) => updateAt(index, { a: e.target.value })}
                  rows={2}
                  placeholder="No. El acceso es gratuito…"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default FaqListEditor;
