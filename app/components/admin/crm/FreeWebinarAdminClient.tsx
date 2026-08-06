"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Trash2, Upload } from "lucide-react";
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
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import StringListEditor from "@/app/components/admin/crm/StringListEditor";
import FaqListEditor from "@/app/components/admin/crm/FaqListEditor";

type Props = {
  initial: FreeWebinarPublic;
  operationalTimezone?: string;
};

const FreeWebinarAdminClient = ({
  initial,
  operationalTimezone = OPERATIONAL_TZ,
}: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const [isActive, setIsActive] = useState(initial.isActive);
  const [headline, setHeadline] = useState(initial.headline);
  const [subheadline, setSubheadline] = useState(initial.subheadline ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const [dateKey, setDateKey] = useState(initial.startsAtDateKey ?? "");
  const [timeHm, setTimeHm] = useState(initial.startsAtTimeHm ?? "");
  const [videoUrl, setVideoUrl] = useState(initial.videoUrl ?? "");
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
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<PublishBlocker[]>([]);
  const [done, setDone] = useState(false);

  const hasSchedule = Boolean(dateKey);

  const savePayload = (overrides: Record<string, unknown> = {}) => ({
    isActive,
    headline: headline.trim(),
    subheadline: subheadline.trim() || null,
    body: body.trim() || null,
    startsAtLocal: dateKey
      ? { date: dateKey, time: timeHm.trim() || null }
      : null,
    videoUrl: videoUrl.trim() || null,
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
    setVideoUrl(webinar.videoUrl ?? "");
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
    return data.webinar!;
  };

  const onToggle = async (next: boolean) => {
    setError(null);
    setBlockers([]);
    setDone(false);
    setToggling(true);
    const prev = isActive;
    setIsActive(next);
    try {
      const payload =
        next && hasSchedule
          ? savePayload({ isActive: true })
          : { isActive: next };
      const webinar = await patch(payload);
      applyWebinar(webinar);
      setDone(true);
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
    setDone(false);
    if (!headline.trim()) {
      setError("El titular es obligatorio.");
      return;
    }
    if (!dateKey && timeHm) {
      setError("Indica la fecha si ya tienes una hora.");
      return;
    }
    setSaving(true);
    try {
      const webinar = await patch(savePayload());
      applyWebinar(webinar);
      setDone(true);
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

  const uploadVideo = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/admin/webinar/video", {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        webinar?: FreeWebinarPublic;
        error?: string;
      };
      if (!res.ok) {
        setError(
          data.error === "blob_not_configured"
            ? "Almacenamiento de archivos no configurado."
            : data.error === "file_too_large"
              ? "El video es demasiado grande (máx. 200 MB)."
              : data.error === "unsupported_type"
                ? "Usa MP4, MOV o WebM."
                : "No se pudo subir el video."
        );
        return;
      }
      if (data.webinar) applyWebinar(data.webinar);
      setDone(true);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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
      setDone(true);
    } finally {
      setUploading(false);
    }
  };

  return (
    <CrmPageShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-[font2] text-2xl uppercase tracking-wide text-[var(--crm-ink)]">
            Webinar gratuito
          </h1>
          <p className="mt-1 max-w-xl text-sm text-black/55">
            Fecha en zona del CRM (
            <span className="font-mono text-black/70">{operationalTimezone}</span>
            ). La hora es opcional hasta que la confirmes. En la web cada
            visitante ve su zona local. El video es opcional.
          </p>
        </div>
        <Link
          href="/webinar-gratuito"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-medium uppercase tracking-wider text-black/70 transition-colors hover:border-terracotta/40 hover:text-terracotta"
        >
          Ver página
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <Card className="mb-6 border-black/8 bg-white/80">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div>
            <p className="text-sm font-medium text-black/80">
              Página pública activa
            </p>
            <p className="mt-0.5 text-xs text-black/45">
              {isActive
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
        <Card className="border-black/8 bg-white/80">
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

        <Card className="border-black/8 bg-white/80">
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              Video (opcional)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Si subes un video, aparece en la landing. Si no hay video, esa
              sección no se muestra.
            </p>
            {videoUrl ? (
              <div className="space-y-3">
                <video
                  src={videoUrl}
                  controls
                  className="aspect-video w-full max-w-lg rounded-xl bg-black/90"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="size-3.5" />
                    Reemplazar
                  </Button>
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
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-3.5" />
                {uploading ? "Subiendo…" : "Subir video (MP4 / MOV / WebM)"}
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadVideo(file);
              }}
            />
          </CardContent>
        </Card>

        <Card className="border-black/8 bg-white/80">
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

        <Card className="border-black/8 bg-white/80">
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">
              Preguntas frecuentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FaqListEditor label="FAQ" items={faq} onChange={setFaq} />
          </CardContent>
        </Card>

        <Card className="border-black/8 bg-white/80">
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
          <p className="text-sm text-[#b4543a]" role="alert">
            {error}
          </p>
        )}
        {blockers.length > 0 && (
          <ul className="list-inside list-disc text-sm text-[#b4543a]">
            {blockers.map((b) => (
              <li key={b}>{PUBLISH_BLOCKER_LABELS[b]}</li>
            ))}
          </ul>
        )}
        {done && !error && (
          <p className="text-sm text-emerald-700" role="status">
            Guardado.
          </p>
        )}

        <div>
          <Button
            type="button"
            disabled={saving || toggling || uploading}
            onClick={() => void onSave()}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>
    </CrmPageShell>
  );
};

export default FreeWebinarAdminClient;
