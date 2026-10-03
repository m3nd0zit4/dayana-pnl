"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import type { WorkshopScheduleSlot } from "@/lib/workshops";
import { normalizeWorkshopSchedule } from "@/lib/workshop-schedule";
import { isValidWorkshopSlug, normalizeWorkshopSlug } from "@/lib/crm/workshop-slug";
import { useCrm } from "../CrmProvider";
import ScheduleSlotEditor from "../ScheduleSlotEditor";
import StringListEditor from "../StringListEditor";
import { CrmField } from "../ui";
import EditionSaveBar from "../editions/EditionSaveBar";
import EditionSection from "../editions/EditionSection";
import { useDirtyBaseline, useUnsavedChangesGuard } from "../editions/dirty-guard";

/** Lo que la pestaña necesita de la edición, ya serializado. */
export type WorkshopPageInitial = {
  slug: string;
  title: string;
  description: string;
  editionLabel: string;
  /** `YYYY-MM-DD` en la zona del CRM, o vacío. */
  dateKey: string;
  /** `HH:MM`, o vacío si la fecha no tiene hora. */
  timeHm: string;
  dateLabel: string;
  scheduleLabel: string;
  capacity: number | null;
  meetingUrl: string;
  focusTopics: string[];
  daySchedule: WorkshopScheduleSlot[];
  /** Ya pasó: la fecha y el enlace quedan de solo lectura. */
  ended: boolean;
};

const ENDED_HINT = "Este taller ya pasó: no se le cambia la fecha ni el enlace. Duplícalo para otra fecha.";

const ERRORS: Record<string, string> = {
  invalid_slug: "La URL solo puede tener minúsculas, números y guiones.",
  slug_taken: "Esa URL ya la usa otro taller.",
  virtual_edition: "Esa URL está reservada.",
  invalid_datetime: "Fecha u hora inválida.",
  invalid_body: "Revisa los campos: algo no tiene el formato esperado.",
};

/**
 * La pestaña «Página» de un taller: lo que sale en su página de venta y en
 * los recordatorios. El precio tiene su pestaña; publicar, cerrar
 * inscripciones, terminar y borrar viven en la cabecera. Bloques plegables
 * en el teléfono y barra de guardar pegada abajo, como en los eventos.
 */
const WorkshopPageEditor = ({
  initial,
  operationalTimezone,
}: {
  initial: WorkshopPageInitial;
  operationalTimezone: string;
}) => {
  const router = useRouter();
  const { toast } = useCrm();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [editionLabel, setEditionLabel] = useState(initial.editionLabel);
  const [slugInput, setSlugInput] = useState(initial.slug);
  const [dateKey, setDateKey] = useState(initial.dateKey);
  const [timeHm, setTimeHm] = useState(initial.timeHm);
  const [dateLabel, setDateLabel] = useState(initial.dateLabel);
  const [scheduleLabel, setScheduleLabel] = useState(initial.scheduleLabel);
  const [capacity, setCapacity] = useState(initial.capacity != null ? String(initial.capacity) : "");
  const [meetingUrl, setMeetingUrl] = useState(initial.meetingUrl);
  const [focusTopics, setFocusTopics] = useState<string[]>(initial.focusTopics);
  const [daySchedule, setDaySchedule] = useState<WorkshopScheduleSlot[]>(initial.daySchedule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Lo que hay en el formulario, tal cual: de aquí sale «Cambios sin guardar». */
  const values = () => ({
    title: title.trim(),
    cardSummary: description.trim() || null,
    editionLabel: editionLabel.trim() || null,
    dateLabel: dateLabel.trim() || null,
    scheduleLabel: scheduleLabel.trim() || null,
    capacity: capacity.trim() ? Number(capacity.trim()) : null,
    focusTopics: focusTopics.map((t) => t.trim()).filter(Boolean),
    daySchedule: normalizeWorkshopSchedule(daySchedule),
    startsAtLocal: dateKey ? { date: dateKey, time: timeHm.trim() || null } : null,
    meetingUrl: meetingUrl.trim() || null,
    slug: normalizeWorkshopSlug(slugInput),
  });

  /**
   * Lo que se manda: el cronograma solo si cambió (normalizarlo reescribe sus
   * textos), la URL solo si es otra, y la fecha y el enlace nunca en uno que
   * ya pasó.
   */
  const payload = () => {
    const { slug, daySchedule: schedule, startsAtLocal, meetingUrl: link, ...rest } = values();
    const scheduleChanged =
      JSON.stringify(schedule) !== JSON.stringify(normalizeWorkshopSchedule(initial.daySchedule));
    return {
      ...rest,
      ...(scheduleChanged ? { daySchedule: schedule } : {}),
      ...(initial.ended ? {} : { startsAtLocal, meetingUrl: link }),
      ...(slug && slug !== initial.slug ? { newSlug: slug } : {}),
    };
  };

  const { dirty, reset: markSaved } = useDirtyBaseline(JSON.stringify(values()));
  useUnsavedChangesGuard(dirty);

  const discard = () => {
    setTitle(initial.title);
    setDescription(initial.description);
    setEditionLabel(initial.editionLabel);
    setSlugInput(initial.slug);
    setDateKey(initial.dateKey);
    setTimeHm(initial.timeHm);
    setDateLabel(initial.dateLabel);
    setScheduleLabel(initial.scheduleLabel);
    setCapacity(initial.capacity != null ? String(initial.capacity) : "");
    setMeetingUrl(initial.meetingUrl);
    setFocusTopics(initial.focusTopics);
    setDaySchedule(initial.daySchedule);
    setError(null);
    markSaved();
  };

  const save = async () => {
    setError(null);
    const body = payload();
    if (!body.title) return setError("El título es obligatorio.");
    if (!initial.ended && timeHm && !dateKey) return setError("Indica la fecha si ya tienes una hora.");
    if (body.newSlug && !isValidWorkshopSlug(body.newSlug)) return setError(ERRORS.invalid_slug);
    if (capacity.trim() && !(Number.isInteger(Number(capacity)) && Number(capacity) >= 0)) {
      return setError("El cupo es un número entero.");
    }
    const link = meetingUrl.trim();
    if (!initial.ended && link) {
      let protocol = "";
      try {
        protocol = new URL(link).protocol;
      } catch {
        // cae abajo
      }
      if (protocol !== "https:") return setError("El enlace de la reunión tiene que empezar por https://.");
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workshops/${encodeURIComponent(initial.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        edition?: { slug: string };
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.edition) {
        setError(data.message ?? ERRORS[data.error ?? ""] ?? "No se pudo guardar.");
        return;
      }
      markSaved();
      toast("Guardado");
      if (data.edition.slug !== initial.slug) {
        router.replace(`/admin/workshops/${encodeURIComponent(data.edition.slug)}?tab=pagina`);
      } else {
        // La cabecera (título, fecha) y la lista se pintan en el servidor.
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const dateSummary = [
    dateKey ? `${dateKey}${timeHm ? ` · ${timeHm}` : ""}` : "Sin fecha",
    meetingUrl.trim() ? "con enlace" : "sin enlace",
    capacity.trim() ? `cupo ${capacity.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <EditionSection title="Fecha, enlace y cupo" summary={dateSummary} defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField
            label="Fecha *"
            description={initial.ended ? ENDED_HINT : "En la web cada visitante ve su hora local."}
          >
            <Input type="date" value={dateKey} disabled={initial.ended} onChange={(e) => setDateKey(e.target.value)} />
          </CrmField>
          <CrmField
            label="Hora de inicio"
            description={`Zona CRM: ${operationalTimezone}.${initial.ended ? "" : " Cambiarla vuelve a mandar los recordatorios."}`}
          >
            <Input type="time" value={timeHm} disabled={initial.ended} onChange={(e) => setTimeHm(e.target.value)} />
          </CrmField>
        </div>
        <CrmField
          label="Enlace de la reunión (Zoom, Meet…)"
          description={
            initial.ended
              ? ENDED_HINT
              : "Solo lo ve quien pagó: en la página del taller y en los recordatorios de 24 h y 1 h (correo y WhatsApp). Si lo cambias antes del taller, los recordatorios vuelven a salir con el enlace nuevo."
          }
        >
          <Input
            type="url"
            value={meetingUrl}
            disabled={initial.ended}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="Pega aquí el enlace de Zoom o Meet"
          />
        </CrmField>
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField label="Cupo" description="Informativo: se muestra en la página. Vacío = sin cupo.">
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="120"
            />
          </CrmField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField label="Texto de la fecha (opcional)" description="Solo si quieres forzar cómo se lee la fecha.">
            <Input value={dateLabel} onChange={(e) => setDateLabel(e.target.value)} placeholder="16 de mayo de 2026" />
          </CrmField>
          <CrmField label="Texto del horario (opcional)">
            <Input
              value={scheduleLabel}
              onChange={(e) => setScheduleLabel(e.target.value)}
              placeholder="7:30 a. m. – 4:30 p. m. · virtual"
            />
          </CrmField>
        </div>
      </EditionSection>

      <EditionSection title="Contenido principal" summary={title}>
        <CrmField label="Título *" description="Corto: sale en la tarjeta, la cabecera y los recordatorios.">
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Tu versión imparable" />
        </CrmField>
        <CrmField label="Descripción *" description="Sale en la tarjeta y en la página. Hace falta para publicar.">
          <Textarea
            className="min-h-[88px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Jornada intensiva de coaching en vivo por Google Meet…"
          />
        </CrmField>
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField label="Etiqueta de la edición">
            <Input value={editionLabel} onChange={(e) => setEditionLabel(e.target.value)} placeholder="Edición 2026" />
          </CrmField>
          <CrmField
            label="URL del taller"
            description="dayanabeltran.com/taller-virtual/… Si la cambias, los enlaces viejos redirigen a la nueva."
          >
            <Input
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              onBlur={() => setSlugInput((v) => normalizeWorkshopSlug(v))}
              placeholder="mi-taller"
            />
          </CrmField>
        </div>
      </EditionSection>

      <EditionSection title="Temas de la jornada" summary={`${focusTopics.filter((t) => t.trim()).length} temas`}>
        <StringListEditor
          label="Temas"
          items={focusTopics}
          onChange={setFocusTopics}
          placeholder="Ej. Reprogramación de creencias"
          addLabel="Agregar tema"
        />
      </EditionSection>

      <EditionSection title="Cronograma del día" summary={`${daySchedule.length} bloques`}>
        <ScheduleSlotEditor label="Bloques" items={daySchedule} onChange={setDaySchedule} />
      </EditionSection>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <EditionSaveBar dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={discard} />
    </div>
  );
};

export default WorkshopPageEditor;
