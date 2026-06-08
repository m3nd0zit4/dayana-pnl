"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";

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
};

const STATUSES: { value: WorkshopEditionStatus; label: string }[] = [
  { value: WorkshopEditionStatus.DRAFT, label: "Borrador" },
  { value: WorkshopEditionStatus.OPEN, label: "Abierto" },
  { value: WorkshopEditionStatus.CLOSED, label: "Cerrado" },
  { value: WorkshopEditionStatus.COMPLETED, label: "Completado" },
];

type Props = {
  open: boolean;
  edition: WorkshopRow | null;
  onClose: () => void;
  onSaved: () => void;
};

const WorkshopFormModal = ({ open, edition, onClose, onSaved }: Props) => {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [editionLabel, setEditionLabel] = useState("");
  const [cardSummary, setCardSummary] = useState("");
  const [status, setStatus] = useState<WorkshopEditionStatus>(
    WorkshopEditionStatus.DRAFT
  );
  const [dateLabel, setDateLabel] = useState("");
  const [scheduleLabel, setScheduleLabel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [whatsappTemplate, setWhatsappTemplate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (edition) {
      setSlug(edition.slug);
      setTitle(edition.title);
      setEditionLabel(edition.editionLabel ?? "");
      setCardSummary(edition.cardSummary ?? "");
      setStatus(edition.status);
      setDateLabel(edition.dateLabel ?? "");
      setScheduleLabel(edition.scheduleLabel ?? "");
      setCapacity(edition.capacity != null ? String(edition.capacity) : "");
      setWhatsappTemplate(edition.whatsappTemplate ?? "");
      setStartsAt(
        edition.startsAt
          ? new Date(edition.startsAt).toISOString().slice(0, 16)
          : ""
      );
    } else {
      setSlug("");
      setTitle("");
      setEditionLabel("");
      setCardSummary("");
      setStatus(WorkshopEditionStatus.DRAFT);
      setDateLabel("");
      setScheduleLabel("");
      setCapacity("");
      setWhatsappTemplate("");
      setStartsAt("");
    }
    setError(null);
  }, [open, edition]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      slug: edition ? slug.trim() : undefined,
      title: title.trim(),
      editionLabel: editionLabel || undefined,
      cardSummary: cardSummary || undefined,
      status,
      dateLabel: dateLabel || undefined,
      scheduleLabel: scheduleLabel || undefined,
      capacity: capacity ? Number(capacity) : undefined,
      whatsappTemplate: whatsappTemplate || undefined,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
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
      large
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="crm-label" htmlFor="w-title">
              Título del taller *
            </label>
            <input
              id="w-title"
              className="crm-input"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
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
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="w-cap">
              Cupos
            </label>
            <input
              id="w-cap"
              type="number"
              min={0}
              className="crm-input"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="w-date">
              Fecha (texto web)
            </label>
            <input
              id="w-date"
              className="crm-input"
              value={dateLabel}
              onChange={(e) => setDateLabel(e.target.value)}
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="w-sched">
              Horario (texto)
            </label>
            <input
              id="w-sched"
              className="crm-input"
              value={scheduleLabel}
              onChange={(e) => setScheduleLabel(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="crm-label" htmlFor="w-start">
              Inicio (datetime)
            </label>
            <input
              id="w-start"
              type="datetime-local"
              className="crm-input"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="crm-label" htmlFor="w-summary">
            Resumen tarjeta
          </label>
          <textarea
            id="w-summary"
            className="crm-textarea"
            value={cardSummary}
            onChange={(e) => setCardSummary(e.target.value)}
          />
        </div>
        <div>
          <label className="crm-label" htmlFor="w-wa">
            Plantilla WhatsApp
          </label>
          <textarea
            id="w-wa"
            className="crm-textarea"
            value={whatsappTemplate}
            onChange={(e) => setWhatsappTemplate(e.target.value)}
          />
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
