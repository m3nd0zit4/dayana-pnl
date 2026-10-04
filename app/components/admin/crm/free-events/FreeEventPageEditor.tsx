"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import * as UpChunk from "@mux/upchunk";
import { FileText, Trash2, Upload, Video } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import { Textarea } from "@/app/components/ui/textarea";
import type { FreeWebinarPublic } from "@/lib/crm/free-webinar";
import {
  PUBLISH_BLOCKER_LABELS,
  type FreeWebinarFaqItem,
  type PublishBlocker,
} from "@/lib/crm/free-webinar-publish";
import { OPERATIONAL_TZ } from "@/lib/datetime/zoned-time";
import { useCrm } from "../CrmProvider";
import { CrmField } from "../ui";
import StringListEditor from "../StringListEditor";
import FaqListEditor from "../FaqListEditor";
import EditionSaveBar from "../editions/EditionSaveBar";
import EditionSection from "../editions/EditionSection";
import { useDirtyBaseline, useUnsavedChangesGuard } from "../editions/dirty-guard";
import { dateKeyLabel } from "../editions/status";

type Props = {
  initial: FreeWebinarPublic;
  operationalTimezone?: string;
  /** `/api/admin/eventos/<id>`: la página, el material y el vídeo de ESTE evento. */
  apiBase: string;
  /** Inscritas sin el enlace todavía: para decir a cuántas se envía al guardarlo. */
  pendingLink?: number;
  /**
   * Ya pasó: la fecha y el enlace quedan de solo lectura (el servidor también
   * lo rechaza). Los textos se pueden corregir.
   */
  ended?: boolean;
};

const ENDED_HINT = "Este evento ya pasó: crea uno nuevo o duplícalo.";

const WebinarMuxVideo = dynamic(
  () => import("@/app/components/webinar/WebinarMuxVideo"),
  { ssr: false }
);

/** Mux tarda en codificar; se sondea hasta que el vídeo queda listo. */
const RECONCILE_MS = 5000;

/**
 * La pestaña «Página» de un evento: todo lo que sale en su landing y en sus
 * correos, en bloques que en el teléfono se pliegan. Publicar, cerrar
 * inscripciones, terminar y borrar viven en la cabecera del evento: guardar
 * textos nunca cambia el estado del evento. La barra de guardar se queda
 * pegada abajo y avisa de los cambios sin guardar (también al salir).
 */
const FreeEventPageEditor = ({
  initial,
  operationalTimezone = OPERATIONAL_TZ,
  apiBase,
  pendingLink = 0,
  ended = false,
}: Props) => {
  const router = useRouter();
  const { toast } = useCrm();
  const fileRef = useRef<HTMLInputElement>(null);
  /** Lo último guardado: a lo que vuelve «Descartar». */
  const saved = useRef(initial);

  const [headline, setHeadline] = useState(initial.headline);
  const [subheadline, setSubheadline] = useState(initial.subheadline ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const [dateKey, setDateKey] = useState(initial.startsAtDateKey ?? "");
  const [timeHm, setTimeHm] = useState(initial.startsAtTimeHm ?? "");
  const [meetUrl, setMeetUrl] = useState(initial.meetUrl ?? "");
  const [capacity, setCapacity] = useState(initial.capacity != null ? String(initial.capacity) : "");
  const [videoStatus, setVideoStatus] = useState(initial.videoStatus);
  const [muxPlaybackId, setMuxPlaybackId] = useState(initial.muxPlaybackId);
  const [videoErrorMessage, setVideoErrorMessage] = useState(initial.videoErrorMessage);
  const [learnSectionTitle, setLearnSectionTitle] = useState(initial.learnSectionTitle ?? "Lo que vas a llevarte");
  const [learnItems, setLearnItems] = useState<string[]>(initial.learnItems.length ? initial.learnItems : [""]);
  const [faq, setFaq] = useState<FreeWebinarFaqItem[]>(initial.faq);
  const [ctaLabel, setCtaLabel] = useState(initial.ctaLabel);
  const [formTitle, setFormTitle] = useState(initial.formTitle);
  const [metaTitle, setMetaTitle] = useState(initial.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(initial.metaDescription ?? "");
  const [eventLabel, setEventLabel] = useState(initial.eventLabel);
  const [locationLabel, setLocationLabel] = useState(initial.locationLabel);
  const [priceLabel, setPriceLabel] = useState(initial.priceLabel);
  const [faqTitle, setFaqTitle] = useState(initial.faqTitle ?? "");
  const [materialLabel, setMaterialLabel] = useState(initial.materialLabel ?? "");
  const [successMessage, setSuccessMessage] = useState(initial.successMessage ?? "");
  const [linkEnabled, setLinkEnabled] = useState(initial.linkEnabled);
  const [linkTitle, setLinkTitle] = useState(initial.linkTitle ?? "");
  const [linkSubtitle, setLinkSubtitle] = useState(initial.linkSubtitle ?? "");
  const [waConfirmationEnabled, setWaConfirmationEnabled] = useState(initial.waConfirmationEnabled);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<PublishBlocker[]>([]);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [material, setMaterial] = useState({
    fileName: initial.materialFileName,
    sizeBytes: initial.materialSizeBytes,
  });
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const materialRef = useRef<HTMLInputElement>(null);

  const videoProcessing = videoStatus === "UPLOADING" || videoStatus === "PROCESSING";
  const videoReady = videoStatus === "READY" && Boolean(muxPlaybackId);

  const savePayload = () => ({
    headline: headline.trim(),
    subheadline: subheadline.trim() || null,
    body: body.trim() || null,
    // En uno que ya pasó ni se mandan: no se reprograma ni cambia de enlace.
    ...(ended
      ? {}
      : {
          startsAtLocal: dateKey ? { date: dateKey, time: timeHm.trim() || null } : null,
          meetUrl: meetUrl.trim() || null,
        }),
    capacity: capacity.trim() ? Number(capacity.trim()) : null,
    learnSectionTitle: learnSectionTitle.trim() || null,
    learnItems: learnItems.map((l) => l.trim()).filter(Boolean),
    faq: faq.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q && f.a),
    ctaLabel: ctaLabel.trim() || "Registrarme gratis",
    formTitle: formTitle.trim() || "Reserva tu lugar",
    metaTitle: metaTitle.trim() || null,
    metaDescription: metaDescription.trim() || null,
    eventLabel: eventLabel.trim() || "Evento gratuito",
    locationLabel: locationLabel.trim() || "Online",
    priceLabel: priceLabel.trim() || "Gratis",
    faqTitle: faqTitle.trim() || null,
    materialLabel: materialLabel.trim() || null,
    successMessage: successMessage.trim() || null,
    linkEnabled,
    linkTitle: linkTitle.trim() || null,
    linkSubtitle: linkSubtitle.trim() || null,
    waConfirmationEnabled,
  });

  // «Cambios sin guardar»: lo que se mandaría ahora contra lo último guardado.
  const { dirty, reset: markSaved } = useDirtyBaseline(JSON.stringify(savePayload()));
  useUnsavedChangesGuard(dirty);

  /** Lo que se guarda con la barra: los campos de texto, fechas e interruptores. */
  const applyFields = (webinar: FreeWebinarPublic) => {
    setHeadline(webinar.headline);
    setSubheadline(webinar.subheadline ?? "");
    setBody(webinar.body ?? "");
    setDateKey(webinar.startsAtDateKey ?? "");
    setTimeHm(webinar.startsAtTimeHm ?? "");
    setMeetUrl(webinar.meetUrl ?? "");
    setCapacity(webinar.capacity != null ? String(webinar.capacity) : "");
    setLearnSectionTitle(webinar.learnSectionTitle ?? "Lo que vas a llevarte");
    setLearnItems(webinar.learnItems.length ? webinar.learnItems : [""]);
    setFaq(webinar.faq);
    setCtaLabel(webinar.ctaLabel);
    setFormTitle(webinar.formTitle);
    setMetaTitle(webinar.metaTitle ?? "");
    setMetaDescription(webinar.metaDescription ?? "");
    setEventLabel(webinar.eventLabel);
    setLocationLabel(webinar.locationLabel);
    setPriceLabel(webinar.priceLabel);
    setFaqTitle(webinar.faqTitle ?? "");
    setMaterialLabel(webinar.materialLabel ?? "");
    setSuccessMessage(webinar.successMessage ?? "");
    setLinkEnabled(webinar.linkEnabled);
    setLinkTitle(webinar.linkTitle ?? "");
    setLinkSubtitle(webinar.linkSubtitle ?? "");
    setWaConfirmationEnabled(webinar.waConfirmationEnabled);
  };

  /**
   * Todo, también el material y el vídeo (que se suben al momento, sin la
   * barra): lo que devuelve el servidor tras guardar.
   */
  const applyWebinar = (webinar: FreeWebinarPublic) => {
    applyFields(webinar);
    setMaterial({ fileName: webinar.materialFileName, sizeBytes: webinar.materialSizeBytes });
    setVideoStatus(webinar.videoStatus);
    setMuxPlaybackId(webinar.muxPlaybackId);
    setVideoErrorMessage(webinar.videoErrorMessage);
  };

  const patch = async (payload: Record<string, unknown>) => {
    const res = await fetch(apiBase, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      webinar?: FreeWebinarPublic;
      meetUrlChanged?: boolean;
      linkEmailsReset?: number;
      error?: string;
      blockers?: PublishBlocker[];
      message?: string;
    };
    if (!res.ok) {
      const err = new Error(data.error ?? "save_failed") as Error & {
        blockers?: PublishBlocker[];
        messageEs?: string;
      };
      err.blockers = data.blockers;
      err.messageEs = data.message;
      throw err;
    }
    return data;
  };

  /** El guardado es el que dispara el envío del enlace: hay que decirlo. */
  const noticeForLink = (meetUrlChanged: boolean | undefined, webinar: FreeWebinarPublic): string | null => {
    if (!meetUrlChanged) return null;
    if (!webinar.meetUrl) return "Se quitó el enlace de la reunión.";
    return pendingLink > 0
      ? `Enlace guardado. Se está enviando por correo a ${pendingLink} inscrita${pendingLink === 1 ? "" : "s"}.`
      : "Enlace guardado. Se enviará a quien se inscriba a partir de ahora.";
  };

  /** Material: un solo archivo, sube por FormData y reemplaza al anterior. */
  const uploadMaterial = async (file: File) => {
    setUploadingMaterial(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${apiBase}/material`, { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { webinar?: FreeWebinarPublic; error?: string };
      if (!res.ok) {
        toast(
          {
            file_too_large: "El archivo pasa de 25 MB.",
            invalid_mime: "Solo PDF, Word o imagen.",
            blob_not_configured: "Almacenamiento de archivos no configurado.",
          }[data.error ?? ""] ?? "No se pudo subir el material",
          "error"
        );
        return;
      }
      if (data.webinar) {
        setMaterial({ fileName: data.webinar.materialFileName, sizeBytes: data.webinar.materialSizeBytes });
      }
      toast("Material subido");
    } finally {
      setUploadingMaterial(false);
      if (materialRef.current) materialRef.current.value = "";
    }
  };

  const removeMaterial = async () => {
    setUploadingMaterial(true);
    try {
      const res = await fetch(`${apiBase}/material`, { method: "DELETE" });
      if (!res.ok) {
        toast("No se pudo quitar el material", "error");
        return;
      }
      setMaterial({ fileName: null, sizeBytes: null });
      toast("Material quitado");
    } finally {
      setUploadingMaterial(false);
    }
  };

  const onSave = async () => {
    setError(null);
    setBlockers([]);
    if (!headline.trim()) {
      setError("El titular es obligatorio.");
      return;
    }
    if (!ended && !dateKey && timeHm) {
      setError("Indica la fecha si ya tienes una hora.");
      return;
    }
    setSaving(true);
    setLinkNotice(null);
    try {
      const data = await patch(savePayload());
      saved.current = data.webinar!;
      applyWebinar(data.webinar!);
      markSaved();
      setLinkNotice(noticeForLink(data.meetUrlChanged, data.webinar!));
      toast("Guardado");
      // La cabecera (fecha, URL) y la lista se pintan en el servidor.
      router.refresh();
    } catch (e) {
      const err = e as Error & { blockers?: PublishBlocker[]; messageEs?: string };
      if (err.blockers?.length) {
        setBlockers(err.blockers);
        setError("Falta completar lo obligatorio.");
      } else {
        setError(err.messageEs ?? "No se pudo guardar.");
      }
    } finally {
      setSaving(false);
    }
  };

  // «Descartar» vuelve a lo guardado solo en los campos de la barra: el
  // material y el vídeo ya se guardaron al subirlos.
  const onDiscard = () => {
    applyFields(saved.current);
    setError(null);
    setBlockers([]);
    markSaved();
  };

  /**
   * Subida directa navegador → Mux con UpChunk (troceada y reanudable), igual
   * que las grabaciones del curso. El servidor solo entrega la URL firmada, así
   * que el límite de tamaño del cuerpo de una función no aplica.
   */
  const uploadVideo = (file: File) => {
    setError(null);
    setUploadPct(0);
    setUploading(true);
    setVideoErrorMessage(null);

    const chunked = UpChunk.createUpload({
      file,
      endpoint: async () => {
        const res = await fetch(`${apiBase}/video`, { method: "POST" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            data.error === "mux_not_configured"
              ? "Mux no está configurado (faltan MUX_TOKEN_ID / MUX_TOKEN_SECRET)."
              : "No se pudo iniciar la subida."
          );
        }
        const data = (await res.json()) as { uploadUrl: string };
        return data.uploadUrl;
      },
    });

    chunked.on("progress", (e) => {
      setUploadPct(Math.round((e.detail as number) ?? 0));
    });

    chunked.on("error", (e) => {
      const detail = e.detail as { message?: string } | undefined;
      setError(detail?.message ?? "No se pudo subir el video.");
      setUploading(false);
      setUploadPct(null);
      if (fileRef.current) fileRef.current.value = "";
    });

    chunked.on("success", () => {
      setUploading(false);
      setUploadPct(null);
      // Mux aún tiene que codificar. El sondeo de `videoProcessing` lo termina.
      setVideoStatus("PROCESSING");
      setMuxPlaybackId(null);
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  // Mux no puede llamar a `localhost`, y en producción un webhook perdido
  // dejaría el vídeo colgado en «procesando». Este sondeo pregunta el estado
  // real a la API de Mux hasta que queda listo (o falla).
  useEffect(() => {
    if (!videoProcessing) return;
    let cancelled = false;

    const tick = async () => {
      const res = await fetch(`${apiBase}/video`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = (await res.json().catch(() => ({}))) as { webinar?: FreeWebinarPublic };
      if (cancelled || !data.webinar) return;
      setVideoStatus(data.webinar.videoStatus);
      setMuxPlaybackId(data.webinar.muxPlaybackId);
      setVideoErrorMessage(data.webinar.videoErrorMessage);
    };

    const id = setInterval(() => void tick(), RECONCILE_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [videoProcessing, apiBase]);

  const removeVideo = async () => {
    setError(null);
    setUploading(true);
    try {
      const res = await fetch(`${apiBase}/video`, { method: "DELETE" });
      if (!res.ok) {
        setError("No se pudo quitar el video.");
        return;
      }
      setVideoStatus("NONE");
      setMuxPlaybackId(null);
      toast("Guardado");
    } finally {
      setUploading(false);
    }
  };

  // Como en los talleres: fecha legible, enlace y cupo.
  const dateSummary = [
    dateKey ? dateKeyLabel(dateKey, timeHm) : "Sin fecha",
    meetUrl.trim() ? "con enlace" : "sin enlace",
    capacity.trim() ? `cupo ${capacity.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <EditionSection title="Fecha, enlace y cupo" summary={dateSummary} defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField label="Fecha *" description={ended ? ENDED_HINT : undefined}>
            <Input type="date" value={dateKey} disabled={ended} onChange={(e) => setDateKey(e.target.value)} />
          </CrmField>
          <CrmField
            label="Hora de inicio (opcional)"
            description={`Zona CRM: ${operationalTimezone}.${ended ? "" : " Cambiar la fecha vuelve a mandar los recordatorios."}`}
          >
            <Input type="time" value={timeHm} disabled={ended} onChange={(e) => setTimeHm(e.target.value)} />
          </CrmField>
        </div>
        <CrmField
          label="Enlace de Google Meet"
          description={
            ended
              ? ENDED_HINT
              : "Al guardar se envía a quien aún no lo tenga. Si lo cambias, se reenvía a todas las inscritas de este evento."
          }
        >
          <Input
            type="url"
            value={meetUrl}
            readOnly={ended}
            disabled={ended}
            onChange={(e) => setMeetUrl(e.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
          />
        </CrmField>
        {!ended && meetUrl.trim() && pendingLink > 0 ? (
          <p className="rounded-lg bg-terracotta/8 px-3 py-2 text-xs text-terracotta">
            {pendingLink.toLocaleString("es-CO")} sin el enlace todavía.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField label="Cupo previsto" description="Informativo: no cierra el registro.">
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="100"
            />
          </CrmField>
        </div>
      </EditionSection>

      <EditionSection title="Contenido principal" summary={headline}>
        <CrmField label="Titular *">
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Reprograma tu mente con PNL" />
        </CrmField>
        <CrmField label="Subtítulo *">
          <Textarea
            value={subheadline}
            onChange={(e) => setSubheadline(e.target.value)}
            rows={2}
            placeholder="Una línea clara de qué es el evento"
          />
        </CrmField>
        <CrmField label="Texto de apoyo (opcional)">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Solo si necesitas una frase más. Si no, déjalo vacío."
          />
        </CrmField>
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField label="Texto del botón *">
            <Input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
          </CrmField>
          <CrmField label="Título del formulario *">
            <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
          </CrmField>
        </div>
      </EditionSection>

      <EditionSection
        title="Temas / qué van a llevarse"
        summary={`${learnItems.filter((l) => l.trim()).length} temas`}
      >
        <CrmField label="Título de la sección">
          <Input
            value={learnSectionTitle}
            onChange={(e) => setLearnSectionTitle(e.target.value)}
            placeholder="Lo que vas a llevarte"
          />
        </CrmField>
        <StringListEditor
          label="Temas *"
          items={learnItems}
          onChange={setLearnItems}
          placeholder="Ej. Un ejercicio práctico para usar desde hoy"
          addLabel="Agregar tema"
        />
      </EditionSection>

      <EditionSection title="Preguntas frecuentes" summary={`${faq.length} preguntas`}>
        <FaqListEditor label="FAQ" items={faq} onChange={setFaq} />
      </EditionSection>

      <EditionSection
        title="Video y material"
        summary={[videoReady ? "Con video" : "Sin video", material.fileName ? "con material" : "sin material"].join(" · ")}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium">Video (opcional)</p>
          <p className="text-xs text-muted-foreground">
            Aparece en la landing. Se procesa en Mux: tarda un par de minutos. Se sube al momento, sin guardar.
          </p>
          {videoReady && muxPlaybackId ? (
            <div className="max-w-lg overflow-hidden rounded-xl bg-black">
              <WebinarMuxVideo playbackId={muxPlaybackId} title={headline} />
            </div>
          ) : null}
          {videoProcessing ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <Video className="size-4 animate-pulse" />
              Procesando en Mux… esta pantalla se actualiza sola.
            </div>
          ) : null}
          {videoStatus === "ERRORED" ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Mux no pudo procesar el video.
              {videoErrorMessage ? ` ${videoErrorMessage}` : ""} Vuelve a subirlo.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || videoProcessing}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-3.5" />
              {uploading
                ? uploadPct != null
                  ? `Subiendo… ${uploadPct}%`
                  : "Subiendo…"
                : videoReady
                  ? "Reemplazar"
                  : "Subir video (MP4 / MOV / WebM)"}
            </Button>
            {videoReady || videoStatus === "ERRORED" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={uploading}
                onClick={() => void removeVideo()}
              >
                <Trash2 className="size-3.5" />
                Quitar video
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadVideo(file);
            }}
          />
          {uploading && uploadPct != null ? (
            <div className="h-1.5 w-full max-w-lg overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-terracotta transition-[width] duration-200"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium">Material descargable (opcional)</p>
          <p className="text-xs text-muted-foreground">
            Una guía o PDF de apoyo. Aparece en la landing como botón de descarga. No hace falta para publicar.
          </p>
          {material.fileName ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{material.fileName}</span>
              {material.sizeBytes ? (
                <span className="text-xs text-muted-foreground">
                  {(material.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadingMaterial}
              onClick={() => materialRef.current?.click()}
            >
              <Upload className="size-3.5" />
              {uploadingMaterial ? "Subiendo…" : material.fileName ? "Reemplazar" : "Subir material (PDF, Word o imagen)"}
            </Button>
            {material.fileName ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={uploadingMaterial}
                onClick={() => void removeMaterial()}
              >
                <Trash2 className="size-3.5" />
                Quitar
              </Button>
            ) : null}
          </div>
          <input
            ref={materialRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadMaterial(file);
            }}
          />
        </div>
      </EditionSection>

      <EditionSection title="WhatsApp al inscribirse" summary={waConfirmationEnabled ? "Encendido" : "Apagado"}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="waConfirmationEnabled">Confirmar por WhatsApp</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              «Quedaste inscrita en … el …», una vez por persona. Gratis si escribió en las últimas 24 h; si no, con
              la plantilla aprobada (si aún no lo está, no sale y solo llega el correo).
            </p>
          </div>
          <Switch
            id="waConfirmationEnabled"
            checked={waConfirmationEnabled}
            onCheckedChange={setWaConfirmationEnabled}
          />
        </div>
      </EditionSection>

      <EditionSection title="Cómo se ve la página" summary={`${eventLabel} · ${locationLabel} · ${priceLabel}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField
            label="Tipo de evento *"
            description="La etiqueta sobre el titular y el nombre del evento en los correos."
          >
            <Input
              value={eventLabel}
              maxLength={60}
              onChange={(e) => setEventLabel(e.target.value)}
              placeholder="Webinar gratuito, Masterclass gratuita…"
            />
          </CrmField>
          <CrmField label="Dónde">
            <Input
              value={locationLabel}
              maxLength={60}
              onChange={(e) => setLocationLabel(e.target.value)}
              placeholder="Online"
            />
          </CrmField>
          <CrmField label="Precio">
            <Input value={priceLabel} maxLength={40} onChange={(e) => setPriceLabel(e.target.value)} placeholder="Gratis" />
          </CrmField>
          <CrmField label="Título de las preguntas">
            <Input
              value={faqTitle}
              maxLength={120}
              onChange={(e) => setFaqTitle(e.target.value)}
              placeholder="Preguntas frecuentes"
            />
          </CrmField>
          <CrmField label="Texto del botón de material">
            <Input
              value={materialLabel}
              maxLength={60}
              onChange={(e) => setMaterialLabel(e.target.value)}
              placeholder="Descargar material"
            />
          </CrmField>
        </div>
        <CrmField label="Mensaje al inscribirse (opcional)">
          <Textarea
            value={successMessage}
            maxLength={600}
            rows={2}
            onChange={(e) => setSuccessMessage(e.target.value)}
            placeholder="Tu lugar quedó reservado. Te enviamos un correo de confirmación y te escribimos con los detalles del evento y el enlace de acceso."
          />
        </CrmField>
      </EditionSection>

      <EditionSection title="Botón en Enlaces" summary={linkEnabled ? "Se muestra en /enlaces" : "No se muestra"}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="linkEnabled">Mostrar en /enlaces</Label>
            <p className="text-xs text-muted-foreground">
              El botón de la página de enlaces de tu bio. Solo aparece mientras el evento está publicado y no ha
              terminado.
            </p>
          </div>
          <Switch id="linkEnabled" checked={linkEnabled} onCheckedChange={setLinkEnabled} />
        </div>
        {linkEnabled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <CrmField label="Título del botón">
              <Input
                value={linkTitle}
                maxLength={80}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder={eventLabel || "Evento gratuito"}
              />
            </CrmField>
            <CrmField label="Subtítulo">
              <Input
                value={linkSubtitle}
                maxLength={120}
                onChange={(e) => setLinkSubtitle(e.target.value)}
                placeholder="Vacío = la fecha en la hora de quien mira"
              />
            </CrmField>
          </div>
        ) : null}
      </EditionSection>

      <EditionSection title="SEO (opcional)" summary={metaTitle || "Sin título propio"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <CrmField label="Título SEO">
            <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
          </CrmField>
          <CrmField label="Descripción SEO">
            <Input value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} />
          </CrmField>
        </div>
      </EditionSection>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {blockers.length > 0 ? (
        <ul className="list-inside list-disc text-sm text-destructive">
          {blockers.map((b) => (
            <li key={b}>{PUBLISH_BLOCKER_LABELS[b]}</li>
          ))}
        </ul>
      ) : null}
      {/* El éxito va por toast. El aviso del enlace sí se queda en línea:
          explica un efecto del guardado (se envía el Meet). */}
      {linkNotice && !error ? (
        <p className="text-sm text-terracotta" role="status">
          {linkNotice}
        </p>
      ) : null}

      <EditionSaveBar
        dirty={dirty}
        saving={saving}
        disabled={uploading}
        onSave={() => void onSave()}
        onDiscard={onDiscard}
      />
    </div>
  );
};

export default FreeEventPageEditor;
