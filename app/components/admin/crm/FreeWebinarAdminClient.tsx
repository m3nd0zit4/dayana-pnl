"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import * as UpChunk from "@mux/upchunk";
import { Trash2, Upload, Video } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
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
import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import {
  CrmFormActions,
  CrmPublicLink,
} from "@/app/components/admin/crm/ui";
import StringListEditor from "@/app/components/admin/crm/StringListEditor";
import FaqListEditor from "@/app/components/admin/crm/FaqListEditor";
import WebinarEditionsPanel, {
  type ArchivedEditionRow,
} from "@/app/components/admin/crm/WebinarEditionsPanel";
import WebinarRegistrantsPanel, {
  type WebinarRegistrantRow,
  type WebinarRegistrationStats,
} from "@/app/components/admin/crm/WebinarRegistrantsPanel";

type Props = {
  initial: FreeWebinarPublic;
  operationalTimezone?: string;
  registrations?: WebinarRegistrantRow[];
  registrationStats?: WebinarRegistrationStats;
  archivedEditions?: ArchivedEditionRow[];
  /** OWNER: unico rol que puede reenviar a todas y borrar historial. */
  canBroadcast?: boolean;
};

const WebinarMuxVideo = dynamic(
  () => import("@/app/components/webinar/WebinarMuxVideo"),
  { ssr: false }
);

/** Mux tarda en codificar; se sondea hasta que el vídeo queda listo. */
const RECONCILE_MS = 5000;

const FreeWebinarAdminClient = ({
  initial,
  operationalTimezone = OPERATIONAL_TZ,
  registrations = [],
  registrationStats = {
    total: 0,
    linkSent: 0,
    reminder24h: 0,
    reminder1h: 0,
    unreachable: 0,
    pendingLink: 0,
    failed: 0,
  },
  archivedEditions = [],
  canBroadcast = false,
}: Props) => {
  const router = useRouter();
  const { toast, confirm } = useCrm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [isActive, setIsActive] = useState(initial.isActive);
  const [headline, setHeadline] = useState(initial.headline);
  const [subheadline, setSubheadline] = useState(initial.subheadline ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const [dateKey, setDateKey] = useState(initial.startsAtDateKey ?? "");
  const [timeHm, setTimeHm] = useState(initial.startsAtTimeHm ?? "");
  const [meetUrl, setMeetUrl] = useState(initial.meetUrl ?? "");
  const [videoStatus, setVideoStatus] = useState(initial.videoStatus);
  const [muxPlaybackId, setMuxPlaybackId] = useState(initial.muxPlaybackId);
  const [videoErrorMessage, setVideoErrorMessage] = useState(
    initial.videoErrorMessage
  );
  const [learnSectionTitle, setLearnSectionTitle] = useState(
    initial.learnSectionTitle ?? "Lo que vas a llevarte"
  );
  const [learnItems, setLearnItems] = useState<string[]>(
    initial.learnItems.length ? initial.learnItems : [""]
  );
  const [faq, setFaq] = useState<FreeWebinarFaqItem[]>(initial.faq);
  const [ctaLabel, setCtaLabel] = useState(initial.ctaLabel);
  const [formTitle, setFormTitle] = useState(initial.formTitle);
  const [metaTitle, setMetaTitle] = useState(initial.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(
    initial.metaDescription ?? ""
  );

  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<PublishBlocker[]>([]);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [endedAt, setEndedAt] = useState<Date | string | null>(initial.endedAt);
  const [busyLifecycle, setBusyLifecycle] = useState(false);

  const hasSchedule = Boolean(dateKey);
  const videoProcessing =
    videoStatus === "UPLOADING" || videoStatus === "PROCESSING";
  const videoReady = videoStatus === "READY" && Boolean(muxPlaybackId);
  // De los contadores agregados, no de las filas cargadas: el panel solo trae
  // las 50 mas recientes y filtrarlas subestimaba el numero a partir de ahi.
  const pendingLinkCount = registrationStats.pendingLink;

  const savePayload = (overrides: Record<string, unknown> = {}) => ({
    isActive,
    headline: headline.trim(),
    subheadline: subheadline.trim() || null,
    body: body.trim() || null,
    startsAtLocal: dateKey
      ? { date: dateKey, time: timeHm.trim() || null }
      : null,
    meetUrl: meetUrl.trim() || null,
    learnSectionTitle: learnSectionTitle.trim() || null,
    learnItems: learnItems.map((l) => l.trim()).filter(Boolean),
    faq: faq
      .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
      .filter((f) => f.q && f.a),
    ctaLabel: ctaLabel.trim() || "Registrarme gratis",
    formTitle: formTitle.trim() || "Reserva tu lugar",
    metaTitle: metaTitle.trim() || null,
    metaDescription: metaDescription.trim() || null,
    ...overrides,
  });

  const applyWebinar = (webinar: FreeWebinarPublic) => {
    setIsActive(webinar.isActive);
    setHeadline(webinar.headline);
    setSubheadline(webinar.subheadline ?? "");
    setBody(webinar.body ?? "");
    setDateKey(webinar.startsAtDateKey ?? "");
    setTimeHm(webinar.startsAtTimeHm ?? "");
    setMeetUrl(webinar.meetUrl ?? "");
    setEndedAt(webinar.endedAt);
    setVideoStatus(webinar.videoStatus);
    setMuxPlaybackId(webinar.muxPlaybackId);
    setVideoErrorMessage(webinar.videoErrorMessage);
    setLearnSectionTitle(webinar.learnSectionTitle ?? "Lo que vas a llevarte");
    setLearnItems(webinar.learnItems.length ? webinar.learnItems : [""]);
    setFaq(webinar.faq);
    setCtaLabel(webinar.ctaLabel);
    setFormTitle(webinar.formTitle);
    setMetaTitle(webinar.metaTitle ?? "");
    setMetaDescription(webinar.metaDescription ?? "");
  };

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/webinar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

  /** El PATCH es el que dispara el envío del enlace: hay que decirlo. */
  const noticeForLink = (
    meetUrlChanged: boolean | undefined,
    webinar: FreeWebinarPublic
  ): string | null => {
    if (!meetUrlChanged) return null;
    if (!webinar.meetUrl) return "Se quitó el enlace de la reunión.";
    return pendingLinkCount > 0
      ? `Enlace guardado. Se está enviando por correo a ${pendingLinkCount} registrada${pendingLinkCount === 1 ? "" : "s"}.`
      : "Enlace guardado. Se enviará a quien se registre a partir de ahora.";
  };


  /** Cerrar o reabrir a mano lo que el cron sella solo. */
  const setEnded = async (ended: boolean) => {
    setBusyLifecycle(true);
    try {
      const data = await patch({ ended });
      applyWebinar(data.webinar!);
      toast(ended ? "Webinar cerrado" : "Webinar reabierto");
    } catch {
      toast("No se pudo cambiar el estado");
    } finally {
      setBusyLifecycle(false);
    }
  };

  /**
   * Archivar es la unica accion manual del ciclo: el cron solo marca que
   * termino. Mueve la edicion al historial con su lista intacta y deja una
   * nueva con los mismos textos y video, pero sin fecha ni enlace.
   */
  const confirmArchive = () => {
    confirm({
      title: "Archivar esta edición",
      message: `Se guardará en el historial con sus ${registrationStats.total.toLocaleString("es-CO")} registradas y se preparará una edición nueva con los mismos textos y vídeo. La fecha y el enlace de reunión quedan vacíos.`,
      confirmLabel: "Archivar",
      onConfirm: async () => {
        setBusyLifecycle(true);
        try {
          const res = await fetch("/api/admin/webinar/editions", {
            method: "POST",
          });
          const data = (await res.json().catch(() => ({}))) as {
            live?: FreeWebinarPublic;
            message?: string;
          };
          if (!res.ok) {
            toast(data.message ?? "No se pudo archivar");
            return;
          }
          if (data.live) applyWebinar(data.live);
          toast("Edición archivada");
          router.refresh();
        } finally {
          setBusyLifecycle(false);
        }
      },
    });
  };

  const onToggle = async (next: boolean) => {
    setError(null);
    setBlockers([]);
    setToggling(true);
    const prev = isActive;
    setIsActive(next);
    try {
      const payload =
        next && hasSchedule
          ? savePayload({ isActive: true })
          : { isActive: next };
      const data = await patch(payload);
      applyWebinar(data.webinar!);
      setLinkNotice(noticeForLink(data.meetUrlChanged, data.webinar!));
      toast("Guardado");
    } catch (e) {
      setIsActive(prev);
      const err = e as Error & { blockers?: PublishBlocker[]; messageEs?: string };
      if (err.blockers?.length) {
        setBlockers(err.blockers);
        setError("No se puede publicar todavía. Completa lo obligatorio.");
      } else {
        setError(err.messageEs ?? "No se pudo cambiar el estado.");
      }
    } finally {
      setToggling(false);
    }
  };

  const onSave = async () => {
    setError(null);
    setBlockers([]);
    if (!headline.trim()) {
      setError("El titular es obligatorio.");
      return;
    }
    if (!dateKey && timeHm) {
      setError("Indica la fecha si ya tienes una hora.");
      return;
    }
    setSaving(true);
    setLinkNotice(null);
    try {
      const data = await patch(savePayload());
      applyWebinar(data.webinar!);
      setLinkNotice(noticeForLink(data.meetUrlChanged, data.webinar!));
      toast("Guardado");
    } catch (e) {
      const err = e as Error & { blockers?: PublishBlocker[]; messageEs?: string };
      if (err.blockers?.length) {
        setBlockers(err.blockers);
        setError("No se puede publicar todavía. Completa lo obligatorio.");
      } else {
        setError(err.messageEs ?? "No se pudo guardar.");
      }
    } finally {
      setSaving(false);
    }
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
        const res = await fetch("/api/admin/webinar/video", { method: "POST" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
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
      const res = await fetch("/api/admin/webinar/video").catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = (await res.json().catch(() => ({}))) as {
        webinar?: FreeWebinarPublic;
      };
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
  }, [videoProcessing]);

  const removeVideo = async () => {
    setError(null);
    setUploading(true);
    try {
      const res = await fetch("/api/admin/webinar/video", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        webinar?: FreeWebinarPublic;
      };
      if (!res.ok) {
        setError("No se pudo quitar el video.");
        return;
      }
      if (data.webinar) applyWebinar(data.webinar);
      toast("Guardado");
    } finally {
      setUploading(false);
    }
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Webinar gratuito"
        description={
          <>
            Fecha en zona del CRM (
            <span className="font-mono text-foreground">{operationalTimezone}</span>
            ). La hora es opcional hasta que la confirmes. En la web cada
            visitante ve su zona local. El video es opcional.
          </>
        }
        // Talleres ya podía copiar el enlace de cada edición; esta página, que
        // tiene una URL fija, no tenía forma de copiarla. Y cuando el webinar
        // está apagado la página pública devuelve 404, así que el botón se
        // muestra deshabilitado con el motivo en vez de llevar a un error.
        secondaryActions={
          <CrmPublicLink
            href="/webinar-gratuito"
            copy
            disabledReason={
              isActive
                ? undefined
                : "La página está oculta: actívala para poder verla."
            }
          />
        }
      />

      {endedAt ? (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Este webinar ya terminó
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Se cerró el{" "}
                {new Date(endedAt).toLocaleString("es-CO", {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
                . La página pública ya no acepta registros y los recordatorios
                dejaron de enviarse. Archívalo para guardar la lista de
                registradas y dejar lista la siguiente edición.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyLifecycle}
                onClick={() => void setEnded(false)}
              >
                Reabrir
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busyLifecycle}
                onClick={confirmArchive}
              >
                Archivar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div>
            <p className="text-sm font-medium text-foreground">
              Página pública activa
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {endedAt
                ? "Terminado: oculta aunque el interruptor siga encendido."
                : isActive
                  ? "Visible en /webinar-gratuito y en Enlaces."
                  : "Oculta (404). El botón en Enlaces también desaparece."}
            </p>
          </div>
          <Switch
            checked={isActive}
            disabled={toggling || saving || uploading}
            onCheckedChange={(v) => void onToggle(v)}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              Contenido principal
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="headline">Titular *</Label>
              <Input
                id="headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Reprograma tu mente con PNL"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="subheadline">Subtítulo *</Label>
              <Textarea
                id="subheadline"
                value={subheadline}
                onChange={(e) => setSubheadline(e.target.value)}
                rows={2}
                placeholder="Una línea clara de qué es el webinar"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="body">Texto de apoyo (opcional)</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={2}
                placeholder="Solo si necesitas una frase más. Si no, déjalo vacío."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateKey">Fecha *</Label>
              <Input
                id="dateKey"
                type="date"
                value={dateKey}
                onChange={(e) => setDateKey(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="timeHm">Hora (opcional)</Label>
              <Input
                id="timeHm"
                type="time"
                value={timeHm}
                onChange={(e) => setTimeHm(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Zona CRM: {operationalTimezone}. Déjala vacía si aún no está
                definida.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ctaLabel">Texto del botón *</Label>
              <Input
                id="ctaLabel"
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="formTitle">Título del formulario *</Label>
              <Input
                id="formTitle"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              Video (opcional)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Si subes un video, aparece en la landing. Si no hay video, esa
              sección no se muestra. Se procesa en Mux — puede tardar un par de
              minutos antes de estar disponible.
            </p>

            {videoReady && muxPlaybackId ? (
              <div className="overflow-hidden rounded-xl bg-black max-w-lg">
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
                {videoErrorMessage ? ` ${videoErrorMessage}` : ""} Vuelve a
                subirlo.
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              Enlace de la reunión
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="meetUrl">Enlace de Google Meet</Label>
              <Input
                id="meetUrl"
                type="url"
                value={meetUrl}
                onChange={(e) => setMeetUrl(e.target.value)}
                placeholder="https://meet.google.com/abc-defg-hij"
              />
              <p className="text-[11px] text-muted-foreground">
                Al guardar, el enlace se envía por correo a todas las
                registradas que aún no lo tienen. Si lo cambias, se reenvía a
                todas. Déjalo vacío hasta tenerlo — quien se registre recibirá
                su confirmación igual, y el enlace le llegará después.
              </p>
            </div>
            {meetUrl.trim() && pendingLinkCount > 0 ? (
              <p className="rounded-lg bg-terracotta/8 px-3 py-2 text-xs text-terracotta">
                {pendingLinkCount} registrada
                {pendingLinkCount === 1 ? "" : "s"} sin el enlace todavía.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              Temas / qué van a llevarse
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="learnSectionTitle">Título de la sección</Label>
              <Input
                id="learnSectionTitle"
                value={learnSectionTitle}
                onChange={(e) => setLearnSectionTitle(e.target.value)}
                placeholder="Lo que vas a llevarte"
              />
            </div>
            <StringListEditor
              label="Temas *"
              items={learnItems}
              onChange={setLearnItems}
              placeholder="Ej. Un ejercicio práctico para usar desde hoy"
              addLabel="Agregar tema"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              Preguntas frecuentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FaqListEditor label="FAQ" items={faq} onChange={setFaq} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              SEO (opcional)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="metaTitle">Título SEO</Label>
              <Input
                id="metaTitle"
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="metaDescription">Descripción SEO</Label>
              <Input
                id="metaDescription"
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {blockers.length > 0 && (
          <ul className="list-inside list-disc text-sm text-destructive">
            {blockers.map((b) => (
              <li key={b}>{PUBLISH_BLOCKER_LABELS[b]}</li>
            ))}
          </ul>
        )}
        {/* El éxito ya no se pinta en verde aquí: va por toast, como en el
            resto del panel. El aviso del enlace sí se queda inline porque
            explica un efecto secundario del guardado (se reenvía el Meet) y
            conviene que permanezca en pantalla. */}
        {linkNotice && !error && (
          <p className="text-sm text-terracotta" role="status">
            {linkNotice}
          </p>
        )}

        <CrmFormActions>
          <Button
            type="button"
            disabled={saving || toggling || uploading}
            onClick={() => void onSave()}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </CrmFormActions>

        <WebinarRegistrantsPanel
          registrations={registrations}
          stats={registrationStats}
          canBroadcast={canBroadcast}
        />

        <WebinarEditionsPanel
          editions={archivedEditions}
          canDelete={canBroadcast}
        />
      </div>
    </CrmPageShell>
  );
};

export default FreeWebinarAdminClient;
