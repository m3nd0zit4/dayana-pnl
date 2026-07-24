"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmModal from "./CrmModal";
import ScheduleSlotEditor from "./ScheduleSlotEditor";
import SearchableSelect from "./SearchableSelect";
import StringListEditor from "./StringListEditor";
import { invalidateCached, useActiveProducts } from "./hooks/useReferenceData";
import type { WorkshopScheduleSlot } from "@/lib/workshops";
import { normalizeWorkshopSchedule, parseWorkshopSchedule } from "@/lib/workshop-schedule";

export type WorkshopRow = {
  id: string;
  slug: string;
  title: string;
  editionLabel: string | null;
  cardSummary: string | null;
  status: WorkshopEditionStatus;
  dateLabel: string | null;
  scheduleLabel: string | null;
  capacity: number | null;
  whatsappTemplate: string | null;
  startsAt: string | null;
  heroLine1: string | null;
  heroLine2: string | null;
  heroLine3: string | null;
  detailSummary: string | null;
  intro: string | null;
  focusTopics: string[] | null;
  daySchedule: WorkshopScheduleSlot[] | null;
  topicsSectionTitle: string | null;
  topicsSectionDescription: string | null;
  scheduleSectionDescription: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  productId: string | null;
};

const STATUSES: { value: WorkshopEditionStatus; label: string }[] = [
  { value: WorkshopEditionStatus.DRAFT, label: "Borrador" },
  { value: WorkshopEditionStatus.OPEN, label: "Abierto" },
  { value: WorkshopEditionStatus.CLOSED, label: "Cerrado" },
  { value: WorkshopEditionStatus.COMPLETED, label: "Completado" },
];

export const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

export const parseSchedule = parseWorkshopSchedule;

type ApiEdition = {
  id: string;
  slug: string;
  title: string;
  editionLabel: string | null;
  cardSummary: string | null;
  status: WorkshopEditionStatus;
  dateLabel: string | null;
  scheduleLabel: string | null;
  capacity: number | null;
  whatsappTemplate: string | null;
  startsAt: string | Date | null;
  heroLine1: string | null;
  heroLine2: string | null;
  heroLine3: string | null;
  detailSummary: string | null;
  intro: string | null;
  focusTopics: unknown;
  daySchedule: unknown;
  topicsSectionTitle: string | null;
  topicsSectionDescription: string | null;
  scheduleSectionDescription: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  productId: string | null;
};

export const mapApiEditionToRow = (e: ApiEdition): WorkshopRow => ({
  id: e.id,
  slug: e.slug,
  title: e.title,
  editionLabel: e.editionLabel,
  cardSummary: e.cardSummary,
  status: e.status,
  dateLabel: e.dateLabel,
  scheduleLabel: e.scheduleLabel,
  capacity: e.capacity,
  whatsappTemplate: e.whatsappTemplate,
  startsAt:
    e.startsAt instanceof Date
      ? e.startsAt.toISOString()
      : e.startsAt,
  heroLine1: e.heroLine1,
  heroLine2: e.heroLine2,
  heroLine3: e.heroLine3,
  detailSummary: e.detailSummary,
  intro: e.intro,
  focusTopics: parseStringArray(e.focusTopics),
  daySchedule: parseWorkshopSchedule(e.daySchedule),
  topicsSectionTitle: e.topicsSectionTitle,
  topicsSectionDescription: e.topicsSectionDescription,
  scheduleSectionDescription: e.scheduleSectionDescription,
  metaTitle: e.metaTitle,
  metaDescription: e.metaDescription,
  productId: e.productId,
});

type Props = {
  open: boolean;
  edition: WorkshopRow | null;
  onClose: () => void;
  onSaved: () => void;
};

const WorkshopFormModal = ({ open, edition, onClose, onSaved }: Props) => {
  // Gated on `open` like the other call sites — no products fetch until the
  // modal is actually opened.
  const { products } = useActiveProducts(open);
  const workshopProducts = products.filter((p) => p.kind === "WORKSHOP");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editionLabel, setEditionLabel] = useState("");
  const [status, setStatus] = useState<WorkshopEditionStatus>(
    WorkshopEditionStatus.DRAFT
  );
  const [dateLabel, setDateLabel] = useState("");
  const [scheduleLabel, setScheduleLabel] = useState("");
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [daySchedule, setDaySchedule] = useState<WorkshopScheduleSlot[]>([]);
  const [productId, setProductId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (edition) {
      setTitle(edition.title);
      setDescription(
        edition.cardSummary?.trim() ||
          edition.detailSummary?.trim() ||
          edition.intro?.trim() ||
          ""
      );
      setEditionLabel(edition.editionLabel ?? "");
      setStatus(edition.status);
      setDateLabel(edition.dateLabel ?? "");
      setScheduleLabel(edition.scheduleLabel ?? "");
      setFocusTopics(edition.focusTopics ?? []);
      setDaySchedule(edition.daySchedule ?? []);
      setProductId(edition.productId ?? "");
    } else {
      setTitle("");
      setDescription("");
      setEditionLabel("");
      setStatus(WorkshopEditionStatus.DRAFT);
      setDateLabel("");
      setScheduleLabel("");
      setFocusTopics([]);
      setDaySchedule([]);
      setProductId("");
    }
    setError(null);
  }, [open, edition]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedTopics = focusTopics.map((t) => t.trim()).filter(Boolean);
    const trimmedSchedule = normalizeWorkshopSchedule(daySchedule);

    const payload = {
      title: trimmedTitle,
      cardSummary: trimmedDescription || undefined,
      editionLabel: editionLabel || undefined,
      status,
      dateLabel: dateLabel || undefined,
      scheduleLabel: scheduleLabel || undefined,
      focusTopics: trimmedTopics.length > 0 ? trimmedTopics : undefined,
      daySchedule: trimmedSchedule.length > 0 ? trimmedSchedule : undefined,
      productId: productId || null,
    };

    const res = await fetch(
      edition
        ? `/api/admin/workshops/${encodeURIComponent(edition.slug)}`
        : "/api/admin/workshops",
      {
        method: edition ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    setLoading(false);
    if (!res.ok) {
      setError("No se pudo guardar el taller.");
      return;
    }
    invalidateCached("workshops");
    onSaved();
    onClose();
  };

  return (
    <CrmModal
      title={edition ? "Editar taller" : "Nueva edición de taller"}
      open={open}
      onClose={onClose}
      large
    >
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-muted-foreground">
          Título corto para la web; la descripción aparece en la tarjeta y en
          la landing. Completa temas, cronograma y CTA abajo.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="w-title">Título *</Label>
          <Input
            id="w-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tu versión imparable"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="w-desc">Descripción *</Label>
          <Textarea
            id="w-desc"
            className="min-h-[88px]"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Jornada intensiva de coaching en vivo por Google Meet…"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SearchableSelect
            id="w-status"
            label="Estado"
            value={status}
            options={STATUSES}
            onChange={(v) => setStatus(v as WorkshopEditionStatus)}
            searchMinOptions={99}
          />
          <div className="space-y-1.5">
            <Label htmlFor="w-edition">Etiqueta edición</Label>
            <Input
              id="w-edition"
              value={editionLabel}
              onChange={(e) => setEditionLabel(e.target.value)}
              placeholder="Edición 2026"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-date">Fecha (tarjeta)</Label>
            <Input
              id="w-date"
              value={dateLabel}
              onChange={(e) => setDateLabel(e.target.value)}
              placeholder="16 de mayo de 2026"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-sched">Horario resumen (tarjeta)</Label>
            <Input
              id="w-sched"
              value={scheduleLabel}
              onChange={(e) => setScheduleLabel(e.target.value)}
              placeholder="7:30 a.m. – 4:30 p.m. · virtual"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <SearchableSelect
            id="w-product"
            label="Producto vinculado (cobro)"
            value={productId}
            options={[
              ...workshopProducts.map((p) => ({ value: p.id, label: p.title })),
              // A linked product that's been deactivated (or its kind
              // changed) no longer appears in the active list — surface it
              // instead of showing a confusingly blank picker while the
              // link silently persists.
              ...(productId && !workshopProducts.some((p) => p.id === productId)
                ? [{ value: productId, label: `(producto inactivo) ${productId}` }]
                : []),
            ]}
            onChange={setProductId}
            allowEmpty
            emptyLabel="Sin producto (solo WhatsApp, sin pago en línea)"
          />
          <p className="text-xs text-muted-foreground">
            Define el precio que se cobra al pagar en línea y qué compra
            desbloquea la página de este taller. Créalo primero en
            Productos si aún no existe (tipo &quot;Taller&quot;).
          </p>
        </div>

        <StringListEditor
          label="Temas de la jornada"
          items={focusTopics}
          onChange={setFocusTopics}
          placeholder="Ej. Reprogramación de creencias"
        />

        <ScheduleSlotEditor
          label="Cronograma del día"
          items={daySchedule}
          onChange={setDaySchedule}
        />

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </CrmModal>
  );
};

export default WorkshopFormModal;
