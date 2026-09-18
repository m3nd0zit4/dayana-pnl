"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmModal from "./CrmModal";
import { CrmField } from "./ui";
import CrmFormActions from "./ui/CrmFormActions";
import ScheduleSlotEditor from "./ScheduleSlotEditor";
import SearchableSelect from "./SearchableSelect";
import StringListEditor from "./StringListEditor";
import WorkshopDocumentsPanel, { type WorkshopDocumentItem } from "./WorkshopDocumentsPanel";
import { invalidateCached } from "./hooks/useReferenceData";
import type { WorkshopScheduleSlot } from "@/lib/workshops";
import { normalizeWorkshopSchedule, parseWorkshopSchedule } from "@/lib/workshop-schedule";
import { minorToMajor } from "@/lib/crm/money";
import { workshopProductIdFor } from "@/lib/crm/workshop-price-rows";
import {
  DEFAULT_OPERATIONAL_TZ,
  getDateKeyInTz,
  getTimeHmInTz,
} from "@/lib/datetime/zoned-time";

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
  timezone?: string | null;
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
  /** Título del producto enlazado — el propio (`taller-<slug>`) o, mientras
   *  no tenga precio propio, uno heredado de Paquetes. */
  productTitle: string | null;
  /** Precio vigente del producto enlazado, por moneda. `null` = sin precio
   *  en esa moneda. */
  prices: { cop: number | null; usd: number | null };
  /** Matrículas activas o completadas ligadas a esta edición. Ausente en
   *  las respuestas de creación/edición — sólo lo trae la lista. */
  paidCount?: number;
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
  timezone?: string | null;
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
  productTitle?: string | null;
  prices?: { cop: number | null; usd: number | null } | null;
  paidCount?: number;
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
  timezone: e.timezone ?? null,
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
  productTitle: e.productTitle ?? null,
  prices: e.prices ?? { cop: null, usd: null },
  paidCount: e.paidCount,
});

type Props = {
  open: boolean;
  edition: WorkshopRow | null;
  operationalTimezone?: string;
  onClose: () => void;
  onSaved: () => void;
};

const WorkshopFormModal = ({
  open,
  edition,
  operationalTimezone = DEFAULT_OPERATIONAL_TZ,
  onClose,
  onSaved,
}: Props) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editionLabel, setEditionLabel] = useState("");
  const [status, setStatus] = useState<WorkshopEditionStatus>(
    WorkshopEditionStatus.DRAFT
  );
  const [dateLabel, setDateLabel] = useState("");
  const [scheduleLabel, setScheduleLabel] = useState("");
  const [dateKey, setDateKey] = useState("");
  const [timeHm, setTimeHm] = useState("");
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [daySchedule, setDaySchedule] = useState<WorkshopScheduleSlot[]>([]);
  /** Pesos enteros, como se escriben. */
  const [priceCop, setPriceCop] = useState("");
  /** Dólares con centavos, como se escriben — se convierten a centavos al
   *  mandar la petición. */
  const [priceUsd, setPriceUsd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<WorkshopDocumentItem[]>([]);

  /**
   * Producto heredado: la edición cobra el precio de un paquete compartido
   * (p. ej. `workshop-virtual`) en vez de tener el suyo propio
   * (`taller-<slug>`). Escribir un precio aquí migra la edición al suyo —
   * lo hace `syncWorkshopEditionPrice` en el servidor.
   */
  const isLegacyProduct =
    !!edition?.productId && edition.productId !== workshopProductIdFor(edition.slug);

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
      if (edition.startsAt) {
        const d = new Date(edition.startsAt);
        const tz = edition.timezone || operationalTimezone;
        setDateKey(getDateKeyInTz(d, tz));
        setTimeHm(getTimeHmInTz(d, tz));
      } else {
        setDateKey("");
        setTimeHm("");
      }
      setFocusTopics(edition.focusTopics ?? []);
      setDaySchedule(edition.daySchedule ?? []);
      setPriceCop(edition.prices?.cop != null ? String(edition.prices.cop) : "");
      setPriceUsd(
        edition.prices?.usd != null
          ? minorToMajor(edition.prices.usd, "USD").toFixed(2)
          : ""
      );
    } else {
      setTitle("");
      setDescription("");
      setEditionLabel("");
      setStatus(WorkshopEditionStatus.DRAFT);
      setDateLabel("");
      setScheduleLabel("");
      setDateKey("");
      setTimeHm("");
      setFocusTopics([]);
      setDaySchedule([]);
      setPriceCop("");
      setPriceUsd("");
    }
    setError(null);
  }, [open, edition, operationalTimezone]);

  useEffect(() => {
    if (!open || !edition) {
      setDocuments([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/workshops/${encodeURIComponent(edition.slug)}/documents`)
      .then((r) => r.json())
      .then((d: { documents?: WorkshopDocumentItem[] }) => {
        if (!cancelled) setDocuments(d.documents ?? []);
      })
      .catch(() => {
        if (!cancelled) setDocuments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, edition]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedTopics = focusTopics.map((t) => t.trim()).filter(Boolean);
    const trimmedSchedule = normalizeWorkshopSchedule(daySchedule);

    const trimmedPriceCop = priceCop.trim();
    const trimmedPriceUsd = priceUsd.trim();
    const parsedPriceCop = trimmedPriceCop !== "" ? Number(trimmedPriceCop) : undefined;
    const parsedPriceUsd = trimmedPriceUsd !== "" ? Number(trimmedPriceUsd) : undefined;

    if (parsedPriceCop !== undefined && (!Number.isFinite(parsedPriceCop) || parsedPriceCop < 0)) {
      setError("El precio en pesos no es válido.");
      return;
    }
    if (parsedPriceUsd !== undefined && (!Number.isFinite(parsedPriceUsd) || parsedPriceUsd < 0)) {
      setError("El precio en dólares no es válido.");
      return;
    }

    const hasSavedPrice = (edition?.prices?.cop ?? null) != null || (edition?.prices?.usd ?? null) != null;
    const hasEnteredPrice = parsedPriceCop !== undefined || parsedPriceUsd !== undefined;
    if (status === WorkshopEditionStatus.OPEN && !hasSavedPrice && !hasEnteredPrice) {
      setError(
        "Para abrir este taller hace falta un precio: escribe el de pesos, el de dólares, o ambos."
      );
      return;
    }

    setLoading(true);

    const payload = {
      title: trimmedTitle,
      cardSummary: trimmedDescription || undefined,
      editionLabel: editionLabel || undefined,
      status,
      dateLabel: dateLabel || undefined,
      scheduleLabel: scheduleLabel || undefined,
      startsAtLocal: dateKey
        ? { date: dateKey, time: timeHm.trim() || null }
        : null,
      focusTopics: trimmedTopics.length > 0 ? trimmedTopics : undefined,
      daySchedule: trimmedSchedule.length > 0 ? trimmedSchedule : undefined,
      priceCop: parsedPriceCop,
      priceUsd: parsedPriceUsd,
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error === "price_sync_failed"
          ? "El taller se guardó, pero no se pudo actualizar su precio. Vuelve a intentarlo."
          : "No se pudo guardar el taller."
      );
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
            <Label htmlFor="w-date-key">Fecha del taller *</Label>
            <Input
              id="w-date-key"
              type="date"
              value={dateKey}
              onChange={(e) => setDateKey(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Zona CRM: {operationalTimezone}. En la web cada visitante ve su
              hora local.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-time">Hora de inicio (opcional)</Label>
            <Input
              id="w-time"
              type="time"
              value={timeHm}
              onChange={(e) => setTimeHm(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-date">Texto fecha (opcional)</Label>
            <Input
              id="w-date"
              value={dateLabel}
              onChange={(e) => setDateLabel(e.target.value)}
              placeholder="Solo si quieres forzar un texto"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-sched">Texto horario (opcional)</Label>
            <Input
              id="w-sched"
              value={scheduleLabel}
              onChange={(e) => setScheduleLabel(e.target.value)}
              placeholder="Ej. jornada completa · virtual"
            />
          </div>
        </div>

        <div className="space-y-3">
          {isLegacyProduct && (
            <Alert variant="warning">
              <AlertDescription>
                Este taller todavía cobra el precio del paquete «
                {edition?.productTitle ?? "vinculado"}». Escribe su precio
                para que tenga el suyo.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <CrmField
              label="Precio en pesos (COP)"
              description="Se cobra con Mercado Pago en Colombia. Es el precio neto: la comisión de cobro se suma en el checkout, igual que en Paquetes."
            >
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={priceCop}
                onChange={(e) => setPriceCop(e.target.value)}
                placeholder="180000"
              />
            </CrmField>
            <CrmField
              label="Precio en dólares (USD)"
              description="Se cobra con PayPal fuera de Colombia. También es el precio neto."
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                placeholder="45.00"
              />
            </CrmField>
          </div>
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

        {edition ? (
          <WorkshopDocumentsPanel
            slug={edition.slug}
            documents={documents}
            onChange={setDocuments}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Guarda el taller primero para poder subir documentos.
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <CrmFormActions size="sm">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Guardando…" : "Guardar"}
          </Button>
        </CrmFormActions>
      </form>
    </CrmModal>
  );
};

export default WorkshopFormModal;
