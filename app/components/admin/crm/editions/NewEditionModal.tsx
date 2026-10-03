"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import CrmModal from "../CrmModal";
import { CrmField, CrmFormActions } from "../ui";

const NONE = "__none__";

export type NewEditionValues = {
  title: string;
  /** `YYYY-MM-DD` o vacío. */
  dateKey: string;
  /** `HH:MM` o vacío. */
  timeHm: string;
  copyFromId: string | null;
};

export type CopySource = {
  id: string;
  /** Lo que sale en la lista: título y fecha. */
  label: string;
  /** Lo que sale ya elegido, más corto. */
  title: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** «Nuevo evento», «Nuevo taller». */
  heading: string;
  titleDescription: string;
  sources: CopySource[];
  /** La que sale elegida al abrir (la más reciente). */
  defaultSourceId?: string | null;
  /** Qué se copia y qué no. */
  copyHint: string;
  operationalTimezone: string;
  /** Crea el borrador; devuelve el mensaje de error o null (y quien llama navega). */
  onCreate: (values: NewEditionValues) => Promise<string | null>;
};

/**
 * «Nuevo …»: título, fecha, hora y de qué edición copiar la página. Lo mínimo
 * para que exista un borrador; el resto se completa en su detalle. Igual para
 * eventos y talleres.
 */
const NewEditionModal = ({
  open,
  onClose,
  heading,
  titleDescription,
  sources,
  defaultSourceId,
  copyHint,
  operationalTimezone,
  onCreate,
}: Props) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dateKey, setDateKey] = useState("");
  const [timeHm, setTimeHm] = useState("");
  const [copyFromId, setCopyFromId] = useState<string>(defaultSourceId ?? NONE);
  const [openedFor, setOpenedFor] = useState(false);

  // Cada vez que se abre, en blanco.
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setTitle("");
      setDateKey("");
      setTimeHm("");
      setError(null);
      setCopyFromId(defaultSourceId ?? NONE);
    }
  }

  const submit = async () => {
    if (timeHm && !dateKey) {
      setError("Indica la fecha si ya tienes una hora.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const failed = await onCreate({
        title: title.trim(),
        dateKey,
        timeHm,
        copyFromId: copyFromId === NONE ? null : copyFromId,
      });
      if (failed) setError(failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <CrmModal title={heading} open={open} onClose={() => !saving && onClose()}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <CrmField label="Título" description={titleDescription}>
          <Input value={title} maxLength={300} onChange={(ev) => setTitle(ev.target.value)} />
        </CrmField>
        <div className="grid grid-cols-2 gap-3">
          <CrmField label="Fecha">
            <Input type="date" value={dateKey} onChange={(ev) => setDateKey(ev.target.value)} />
          </CrmField>
          <CrmField label="Hora" description={operationalTimezone}>
            <Input type="time" value={timeHm} onChange={(ev) => setTimeHm(ev.target.value)} />
          </CrmField>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-none">Copiar la página de…</p>
          <Select value={copyFromId} onValueChange={(v) => setCopyFromId(typeof v === "string" ? v : NONE)}>
            <SelectTrigger aria-label="Copiar la página de" className="w-full">
              <SelectValue>
                {(value) =>
                  value === NONE ? "Empezar de cero" : (sources.find((s) => s.id === value)?.title ?? "Empezar de cero")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Empezar de cero</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{copyHint}</p>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <CrmFormActions>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Creando…" : "Crear borrador"}
          </Button>
        </CrmFormActions>
      </form>
    </CrmModal>
  );
};

export default NewEditionModal;
