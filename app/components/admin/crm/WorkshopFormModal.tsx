"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import CrmModal from "./CrmModal";
import ScheduleSlotEditor from "./ScheduleSlotEditor";
import SearchableSelect from "./SearchableSelect";
import StringListEditor from "./StringListEditor";
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
  introOpen: string | null;
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
  introOpen: string | null;
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
  introOpen: e.introOpen,
});

type Props = {
  open: boolean;
  edition: WorkshopRow | null;
  onClose: () => void;
  onSaved: () => void;
};

const WorkshopFormModal = ({ open, edition, onClose, onSaved }: Props) => {
  const [slug, setSlug] = useState("");
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
  const [introOpen, setIntroOpen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (edition) {
      setSlug(edition.slug);
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
      setIntroOpen(edition.introOpen ?? "");
    } else {
      setSlug("");
      setTitle("");
      setDescription("");
      setEditionLabel("");
      setStatus(WorkshopEditionStatus.DRAFT);
      setDateLabel("");
      setScheduleLabel("");
      setFocusTopics([]);
      setDaySchedule([]);
      setIntroOpen("");
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
      slug: slug.trim() || undefined,
      title: trimmedTitle,
      cardSummary: trimmedDescription || undefined,
      editionLabel: editionLabel || undefined,
      status,
      dateLabel: dateLabel || undefined,
      scheduleLabel: scheduleLabel || undefined,
      focusTopics: trimmedTopics.length > 0 ? trimmedTopics : undefined,
      daySchedule: trimmedSchedule.length > 0 ? trimmedSchedule : undefined,
      introOpen: introOpen.trim() || undefined,
    };

    const res = await fetch("/api/admin/workshops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    setLoading(false);
    if (!res.ok) {
      setError("No se pudo guardar el taller.");
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <CrmModal
      title={edition ? "Editar taller" : "Nueva edición de taller"}
      open={open}
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-[var(--crm-muted)]">
          Título corto para la web; la descripción aparece en la tarjeta y en
          la landing. Completa temas, cronograma y CTA abajo.
        </p>

        <div>
          <label className="crm-label" htmlFor="w-title">
            Título *
          </label>
          <input
            id="w-title"
            className="crm-input"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tu versión imparable"
          />
        </div>

        <div>
          <label className="crm-label" htmlFor="w-desc">
            Descripción *
          </label>
          <textarea
            id="w-desc"
            className="crm-textarea min-h-[88px]"
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
          <div>
            <label className="crm-label" htmlFor="w-edition">
              Etiqueta edición
            </label>
            <input
              id="w-edition"
              className="crm-input"
              value={editionLabel}
              onChange={(e) => setEditionLabel(e.target.value)}
              placeholder="Edición 2026"
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="w-date">
              Fecha (tarjeta)
            </label>
            <input
              id="w-date"
              className="crm-input"
              value={dateLabel}
              onChange={(e) => setDateLabel(e.target.value)}
              placeholder="16 de mayo de 2026"
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="w-sched">
              Horario resumen (tarjeta)
            </label>
            <input
              id="w-sched"
              className="crm-input"
              value={scheduleLabel}
              onChange={(e) => setScheduleLabel(e.target.value)}
              placeholder="7:30 a.m. – 4:30 p.m. · virtual"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="crm-label" htmlFor="w-slug">
              Slug URL
            </label>
            <input
              id="w-slug"
              className="crm-input font-mono text-sm"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="Se genera solo si lo dejas vacío"
            />
            <p className="mt-1 text-xs text-[var(--crm-muted)]">
              Página pública: /taller-virtual/{slug.trim() || "…"} (solo con
              estado Abierto)
            </p>
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

        <div>
          <label className="crm-label" htmlFor="w-cta">
            Mensaje de inscripción (CTA)
          </label>
          <textarea
            id="w-cta"
            className="crm-textarea"
            value={introOpen}
            onChange={(e) => setIntroOpen(e.target.value)}
            placeholder="Escríbenos por WhatsApp para reservar tu cupo…"
          />
          <p className="mt-1 text-xs text-[var(--crm-muted)]">
            Si lo dejas vacío, se usa un texto predeterminado. El botón de
            WhatsApp también se genera solo con el título.
          </p>
        </div>

        {error && (
          <p className="text-sm text-[var(--crm-danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="crm-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="crm-btn-primary" disabled={loading}>
            {loading ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </CrmModal>
  );
};

export default WorkshopFormModal;
