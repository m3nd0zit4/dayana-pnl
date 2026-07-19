"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";

export type NotificationToggleItem = {
  key: string;
  label: string;
  description: string;
  checked: boolean;
};

type NotificationTogglesFormProps = {
  items: NotificationToggleItem[];
  saveUrl: string;
};

const NotificationTogglesForm = ({
  items: initialItems,
  saveUrl,
}: NotificationTogglesFormProps) => {
  const [items, setItems] = useState(initialItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const toggle = (key: string, checked: boolean) => {
    setDone(false);
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, checked } : i)));
  };

  const save = async () => {
    setError(null);
    setLoading(true);
    const body: Record<string, boolean> = {};
    for (const i of items) body[i.key] = i.checked;

    const res = await fetch(saveUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);

    if (!res.ok) {
      setError("No se pudo guardar. Intenta de nuevo.");
      return;
    }
    setDone(true);
  };

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.key} className="flex items-start justify-between gap-4 border-b pb-4 last:border-b-0">
          <div className="space-y-0.5">
            <Label htmlFor={`notif-${item.key}`}>{item.label}</Label>
            <p className="text-sm text-muted-foreground">{item.description}</p>
          </div>
          <Switch
            id={`notif-${item.key}`}
            checked={item.checked}
            onCheckedChange={(checked) => toggle(item.key, checked)}
          />
        </div>
      ))}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-emerald-600" role="status">
          Preferencias guardadas.
        </p>
      )}

      <Button type="button" disabled={loading} onClick={save}>
        {loading ? "Guardando…" : "Guardar cambios"}
      </Button>
    </div>
  );
};

export default NotificationTogglesForm;
