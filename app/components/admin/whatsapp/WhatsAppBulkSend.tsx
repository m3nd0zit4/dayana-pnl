"use client";

import { CheckCircle2, ImagePlus, Loader2, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  EVENT_REMINDER_UTILITY_TEMPLATE_KEY,
  EVENT_REMINDER_UTILITY_TEMPLATE_TITLE,
  isTemplateApproved,
  type TemplateBilling,
} from "@/lib/crm/event-reminder-template";
import { presetMissingLink, resolvePresetVars } from "@/lib/crm/whatsapp-presets";
import CrmModal from "../crm/CrmModal";
import { useCrm } from "../crm/CrmProvider";
import type { WhatsAppPreset } from "./SendWhatsAppDialog";

type Preview = {
  total: number;
  text: number;
  template: number;
  skipped: { no_phone: number; opted_out: number; needs_template: number };
  estimatedCost: number;
  currency: string;
  /** `rates`: tarifas de Meta por país; `manual`: el precio puesto en Plantillas. */
  costSource?: "rates" | "manual";
  /** Cuántas plantillas y cuánto, por grupo de país. */
  costByCountry?: { key: string; label: string; count: number; subtotal: number }[];
  templateInfo: { key: string; title: string; category: string | null; status: string | null } | null;
  phoneOnly: { contactId: string; name: string | null; phone: string; suggested: string | null }[];
  /** `IMAGE`: la plantilla lleva imagen arriba; `UNKNOWN`: no se pudo mirar. */
  templateHeader?: string | null;
};

type Progress = {
  status: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  /** Por qué terminó antes de tiempo (p. ej. la imagen caducó). */
  notice?: string;
};

/** Lo que el diálogo necesita de una plantilla aprobada para ofrecerla. */
type ApprovedTemplate = { key: string; title: string; body: string; metaVarNames: string[] };

/** Cómo la cobra Meta, según la categoría que le dejó. */
const categoryLabel = (category: string | null | undefined): string | null => {
  const c = (category ?? "").toUpperCase();
  return c === "UTILITY" ? "Meta la cobra como Utilidad" : c === "MARKETING" ? "Meta la cobra como Marketing" : null;
};

/** WhatsApp: JPG o PNG de hasta 5 MB. */
const IMAGE_TYPES = ["image/jpeg", "image/png"];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Un motivo para mostrarle tal cual a quien envía. */
class ShownError extends Error {}

/** «US$ 2.89» (o «2.89 COP» con un precio puesto a mano en otra moneda). */
const money = (amount: number, currency: string) =>
  currency === "USD" ? `US$ ${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`;

/**
 * A quién le llega la imagen con una plantilla solo de texto: dentro de las
 * 24 h sí (imagen con el texto de pie); fuera, solo la plantilla de texto.
 */
const windowOnlyImageNote = (inWindow: number, outside: number): string => {
  const reached =
    inWindow === 0
      ? "Nadie de esta lista escribió en las últimas 24 h, así que la imagen no le llega a nadie."
      : inWindow === 1
        ? "La imagen le llega a la persona que escribió en las últimas 24 h."
        : `La imagen les llega a las ${inWindow} que escribieron en las últimas 24 h.`;
  if (outside === 0) return inWindow === 0 ? "" : reached;
  const others =
    outside === 1
      ? "A la persona restante le llega solo el texto, porque WhatsApp exige una plantilla aprobada con imagen para ella."
      : `A las ${outside} restantes les llega solo el texto, porque WhatsApp exige una plantilla aprobada con imagen para ellas.`;
  return `${reached} ${others} Cuando Meta apruebe una plantilla con imagen, elígela arriba y les llega a todas.`;
};

/** El motivo que manda el servidor (`message`), o `fallback`. */
const readError = async (res: Response, fallback: string): Promise<ShownError> => {
  const d = (await res.json().catch(() => ({}))) as { message?: string };
  if (d.message) return new ShownError(d.message);
  // El servidor corta los cuerpos de más de ~4,5 MB antes de llegar a la ruta.
  if (res.status === 413) return new ShownError("La imagen pesa demasiado para subirla: usa una de menos de 4 MB.");
  return new ShownError(fallback);
};

/**
 * Enviar por WhatsApp a varias personas a la vez (inscritas de un evento,
 * alumnas de un taller, diagnósticos…). Muestra antes cuántos van gratis,
 * cuántos con plantilla (y el costo) y cuántos no se pueden; al confirmar
 * envía por tandas con barra de progreso.
 */
const WhatsAppBulkSend = ({
  contactIds,
  presets,
  kind,
  title,
  onDone,
  label = "Enviar por WhatsApp",
  create,
  link,
}: {
  contactIds: string[];
  presets: WhatsAppPreset[];
  kind: "evento" | "taller" | "diagnostico" | "pago" | "libre" | "comunidad";
  title: string;
  onDone?: () => void;
  label?: string;
  /** El evento o el taller del envío: queda en su historia. */
  link?: { freeWebinarId?: string | null; workshopEditionId?: string | null };
  /**
   * Arma el envío en otra ruta (p. ej. la comunidad, que además deja a cada
   * persona como invitada). Devuelve el id del envío; las tandas son las de siempre.
   */
  create?: (input: { contactIds: string[]; text: string; templateKey: string | null }) => Promise<{ id: string }>;
}) => {
  const { toast } = useCrm();
  const [open, setOpen] = useState(false);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  const [text, setText] = useState(preset?.text ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  // Otra plantilla aprobada en vez de la del mensaje (p. ej. una con imagen
  // creada en el Hub). `null` = la del mensaje.
  const [approved, setApproved] = useState<ApprovedTemplate[]>([]);
  // La de utilidad del recordatorio a inscritas (si ya se mandó a Meta), para
  // sugerirla cuando la elegida se cobra como Marketing.
  const [utilityReminder, setUtilityReminder] = useState<TemplateBilling | null>(null);
  const [templateOverride, setTemplateOverride] = useState<string | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const templateKey = templateOverride ?? preset?.templateKey ?? null;
  const chosen = approved.find((t) => t.key === templateKey) ?? null;

  useEffect(() => {
    setText(preset?.text ?? "");
    setTemplateOverride(null);
  }, [presetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Las aprobadas que este mensaje puede llenar: sin variables, o con las que
  // trae el mensaje. Una con variables que no tiene saldría con guiones.
  useEffect(() => {
    if (!open) return;
    void fetch("/api/admin/whatsapp/templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: (ApprovedTemplate & TemplateBilling)[] } | null) => {
        const items = d?.items ?? [];
        setApproved(items.filter((t) => isTemplateApproved(t)));
        setUtilityReminder(items.find((t) => t.key === EVENT_REMINDER_UTILITY_TEMPLATE_KEY) ?? null);
      })
      .catch(() => undefined);
  }, [open]);
  const pickable = approved.filter(
    (t) =>
      t.key !== preset?.templateKey &&
      t.metaVarNames.every((v) => v === "nombre" || Object.hasOwn(preset?.vars ?? {}, v))
  );

  useEffect(() => {
    if (!open || contactIds.length === 0) return;
    setPreview(null);
    void fetch("/api/admin/whatsapp/sends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", contactIds, templateKey, kind, checkHeader: !create }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPreview(d as Preview));
  }, [open, contactIds, templateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = preview?.templateHeader ?? null;
  const needsImage = header === "IMAGE";
  // La imagen siempre se puede adjuntar (salvo cuando otra ruta arma el
  // envío). Con una plantilla con imagen arriba les llega a todas y es
  // obligatoria; con una solo de texto, solo a quienes escribieron en las
  // últimas 24 h. Si no se pudo comprobar, el servidor lo vuelve a mirar al
  // crear el envío y lo dice.
  const canImage = !create;
  const imageWindowOnly = Boolean(preview) && header !== "IMAGE" && header !== "UNKNOWN";
  const imageToSend = canImage ? image : null;

  const pickImage = (file: File | null) => {
    setImageError(null);
    if (!file) return setImage(null);
    if (!IMAGE_TYPES.includes(file.type)) return setImageError("La imagen debe ser JPG o PNG.");
    if (file.size > IMAGE_MAX_BYTES) return setImageError("La imagen pesa más de 5 MB (el tope de WhatsApp).");
    setImage(file);
  };

  const pickTemplate = (key: string) => {
    const t = approved.find((a) => a.key === key);
    if (!t || key === preset?.templateKey) {
      setTemplateOverride(null);
      setText(preset?.text ?? "");
      return;
    }
    // Quien escribió en las últimas 24 h recibe lo mismo: el texto de la plantilla.
    setTemplateOverride(key);
    setText(t.body);
  };

  const run = async () => {
    setRunning(true);
    try {
      // La imagen se sube una sola vez; el envío guarda su id y lo reutiliza.
      let headerImageId: string | null = null;
      // La misma imagen guardada para el chat del CRM (si se pudo).
      let headerImageCopy: { url: string; mimeType: string } | null = null;
      if (imageToSend) {
        const form = new FormData();
        form.append("file", imageToSend);
        const res = await fetch("/api/admin/whatsapp/sends/image", { method: "POST", body: form });
        if (!res.ok) throw await readError(res, "No se pudo subir la imagen a WhatsApp.");
        const uploaded = (await res.json()) as { id: string; copy?: { url: string; mimeType: string } | null };
        headerImageId = uploaded.id;
        headerImageCopy = uploaded.copy ?? null;
      }
      const { id } = create
        ? await create({ contactIds, text, templateKey })
        : await fetch("/api/admin/whatsapp/sends", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create",
              contactIds,
              templateKey,
              title: `${title} · ${templateOverride && chosen ? chosen.title : (preset?.label ?? "")}`.trim(),
              kind,
              text,
              vars: resolvePresetVars(preset?.vars, text),
              freeWebinarId: link?.freeWebinarId ?? null,
              workshopEditionId: link?.workshopEditionId ?? null,
              headerImageId,
              headerImageCopy,
            }),
          }).then(async (res) => {
            if (!res.ok) throw await readError(res, "No se pudo preparar el envío.");
            return (await res.json()) as { id: string };
          });
      let notice: string | undefined;
      for (;;) {
        const step = await fetch(`/api/admin/whatsapp/sends/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "next" }),
        });
        if (!step.ok) throw await readError(step, "");
        const p = (await step.json()) as Progress;
        setProgress(p);
        notice = p.notice;
        if (p.pending === 0 || p.status === "DONE" || p.status === "CANCELLED") break;
      }
      // Terminó antes de tiempo (la imagen caducó): el motivo, no «terminado».
      if (notice) toast(notice, "error");
      else toast("Envío terminado", "success");
      onDone?.();
    } catch (e) {
      toast(
        e instanceof ShownError && e.message
          ? e.message
          : "El envío se interrumpió. Puedes volver a intentarlo: no se repite a quien ya le llegó.",
        "error"
      );
    } finally {
      setRunning(false);
    }
  };

  const toSend = preview ? preview.text + preview.template : 0;
  // Desglose del costo por país (Colombia 200 (US$ 2.50) · México 20…).
  const costGroups = preview?.costByCountry ?? [];
  // Cómo cobra Meta la plantilla elegida. Un recordatorio a inscritas que Meta
  // cobra como Marketing: la de utilidad sale mucho más barata (salvo que Meta
  // también la haya pasado a Marketing). Solo recordatorios: una invitación
  // es Marketing de verdad.
  const templateCategory = (preview?.templateInfo?.category ?? "").toUpperCase();
  const chargedAs = categoryLabel(templateCategory);
  const utilityApproved = isTemplateApproved(utilityReminder);
  const suggestUtility =
    (kind === "evento" || kind === "taller") &&
    templateCategory === "MARKETING" &&
    /recordatorio/.test(preview?.templateInfo?.key ?? "") &&
    preview?.templateInfo?.key !== EVENT_REMINDER_UTILITY_TEMPLATE_KEY &&
    !(utilityApproved && (utilityReminder?.metaCategory ?? "").toUpperCase() !== "UTILITY");
  const utilityPickable = pickable.some((t) => t.key === EVENT_REMINDER_UTILITY_TEMPLATE_KEY);
  const done = progress && progress.pending === 0;
  // La grabación de un evento pasado no vive en el CRM: el enlace se pega aquí.
  const missingLink = presetMissingLink(preset, text);
  const missingImage = needsImage && !image;
  // Dentro de las 24 h el texto va como pie de la imagen y WhatsApp lo admite
  // hasta 1024. Solo avisa: si no cabe, el servidor manda la imagen sola y el
  // texto aparte (lo mide ya con el nombre de cada persona).
  const captionTooLong = Boolean(imageToSend) && text.length > 1024;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setProgress(null);
          setOpen(true);
        }}
        disabled={contactIds.length === 0}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-40"
      >
        <MessageCircle className="size-4" /> {label}
        {contactIds.length > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{contactIds.length}</span>}
      </button>

      <CrmModal title={`WhatsApp a ${contactIds.length} personas`} open={open} onClose={() => !running && setOpen(false)} large>
        <div className="space-y-3 text-sm">
          {!progress && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPresetId(p.id)}
                    className={`h-10 rounded-full px-3 text-xs font-medium md:h-7 ${presetId === p.id ? "bg-[#00a884] text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {pickable.length > 0 && (
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Plantilla para quien no escribió en las últimas 24 h</span>
                  <select
                    value={templateOverride ?? ""}
                    onChange={(e) => pickTemplate(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-card px-2 text-base outline-none focus:border-[#00a884] md:h-9 md:text-sm"
                  >
                    <option value="">La de este mensaje{preset?.templateKey ? ` (${preset.templateKey})` : ""}</option>
                    {pickable.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                  {templateOverride
                    ? "Texto de la plantilla: es lo que recibe también quien escribió en las últimas 24 h (gratis)."
                    : <>Mensaje para quien escribió en las últimas 24 h (gratis). {"{{nombre}}"} pone su nombre.</>}
                </span>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg border border-border bg-card p-2.5 text-base outline-none focus:border-[#00a884] md:text-sm"
                />
              </label>
              {missingLink && (
                <p className="text-xs text-destructive">
                  Pega en el mensaje el enlace de la grabación o del material: también va en la plantilla.
                </p>
              )}
              {canImage && (
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-foreground">
                    {needsImage ? "Imagen (obligatoria con esta plantilla)" : "Imagen (opcional)"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {needsImage
                      ? "Esta plantilla lleva una imagen arriba: adjúntala (JPG o PNG, hasta 5 MB). Se sube una sola vez y les llega a todas."
                      : header === "UNKNOWN"
                        ? "JPG o PNG, hasta 5 MB. No pude comprobar en 360dialog si la plantilla lleva imagen arriba: lo vuelvo a mirar al enviar."
                        : "JPG o PNG, hasta 5 MB. Va con el texto de pie."}
                  </span>
                  {imageWindowOnly && preview && (preview.text > 0 || preview.template > 0) && (
                    <p className="text-xs text-foreground">{windowOnlyImageNote(preview.text, preview.template)}</p>
                  )}
                  {image && imageUrl ? (
                    <div className="flex items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
                      <img
                        src={imageUrl}
                        alt="Imagen que va arriba del mensaje"
                        className="max-h-40 rounded-lg border border-border object-contain"
                      />
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="break-all">{image.name}</div>
                        <div>{(image.size / 1024 / 1024).toFixed(1)} MB</div>
                        <button
                          type="button"
                          onClick={() => pickImage(null)}
                          className="inline-flex h-10 items-center gap-1 rounded-full px-2 hover:bg-muted md:h-7"
                        >
                          <X className="size-3.5" /> Quitar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm hover:bg-muted md:h-9">
                      <ImagePlus className="size-4" /> Elegir imagen
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        className="sr-only"
                        onChange={(e) => {
                          pickImage(e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  {imageError && <p className="text-xs text-destructive">{imageError}</p>}
                  {missingImage && !imageError && (
                    <p className="text-xs text-destructive">Sin la imagen, WhatsApp rechaza esta plantilla.</p>
                  )}
                  {captionTooLong && (
                    <p className="text-xs text-muted-foreground">
                      El texto tiene {text.length} caracteres y el pie de una imagen admite hasta 1024: a quien escribió en
                      las últimas 24 h le llega la imagen y, justo después, el texto en otro mensaje.
                    </p>
                  )}
                </div>
              )}

              {!preview ? (
                <Loader2 className="size-4 animate-spin text-[#00a884]" />
              ) : (
                <div className="space-y-1.5 rounded-lg bg-muted/60 p-3">
                  <div className="font-medium text-foreground">A quién le llega</div>
                  <div>
                    ✅ {preview.text} con {imageToSend ? "la imagen y " : ""}el mensaje de arriba (gratis, escribieron hace menos de
                    24 h) · 0 US$
                  </div>
                  <div>
                    📨 {preview.template} con la plantilla{" "}
                    {preview.templateInfo ? `«${preview.templateInfo.title}»` : ""}
                    {imageToSend && preview.template > 0 && (needsImage ? " (con la imagen)" : imageWindowOnly ? " (solo el texto)" : "")}
                    {chargedAs && (
                      <span className="ml-1.5 inline-block rounded-full bg-card px-2 py-0.5 align-middle text-[11px] text-muted-foreground">
                        {chargedAs}
                      </span>
                    )}
                  </div>
                  {suggestUtility && (
                    <div className="text-xs text-foreground">
                      Es un recordatorio a personas inscritas: usa «{EVENT_REMINDER_UTILITY_TEMPLATE_TITLE}»
                      {utilityApproved ? "" : " (en revisión de Meta)"}, que Meta cobra mucho más barato.
                      {utilityPickable && (
                        <button
                          type="button"
                          onClick={() => pickTemplate(EVENT_REMINDER_UTILITY_TEMPLATE_KEY)}
                          className="ml-1.5 inline-flex h-10 items-center rounded-full px-2 font-medium text-[#008069] hover:bg-muted md:h-6"
                        >
                          Usarla
                        </button>
                      )}
                    </div>
                  )}
                  <div className="font-medium text-foreground">
                    Costo aproximado: {money(preview.estimatedCost, preview.currency)}{" "}
                    <span className="font-normal text-muted-foreground">
                      {preview.costSource === "manual"
                        ? "(con el precio por plantilla que pusiste en Plantillas; puede variar un poco)"
                        : "(tarifas de Meta por país; puede variar un poco)"}
                    </span>
                  </div>
                  {costGroups.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {costGroups.map((g) => `${g.label} ${g.count} (${money(g.subtotal, preview.currency)})`).join(" · ")}
                    </div>
                  )}
                  {preview.skipped.needs_template > 0 && (
                    <div className="text-destructive">
                      ⚠️ {preview.skipped.needs_template} no se pueden: pasaron más de 24 h y{" "}
                      {preview.templateInfo
                        ? `la plantilla «${preview.templateInfo.title}» está ${preview.templateInfo.status === "APPROVED" ? "aprobada" : "en revisión o rechazada"}`
                        : "no hay plantilla para esto"}
                      . Créala o revísala en WhatsApp → Plantillas.
                    </div>
                  )}
                  {preview.skipped.no_phone > 0 && <div className="text-muted-foreground">— {preview.skipped.no_phone} sin número de WhatsApp</div>}
                  {preview.skipped.opted_out > 0 && <div className="text-muted-foreground">— {preview.skipped.opted_out} pidieron no recibir mensajes</div>}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-full px-4 text-muted-foreground hover:bg-muted">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={!preview || toSend === 0 || running || !text.trim() || missingLink || missingImage}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 font-medium text-white hover:bg-[#008069] disabled:opacity-50"
                >
                  <Send className="size-4" /> Enviar a {toSend}
                </button>
              </div>
            </>
          )}

          {progress && (
            <div className="space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-[#00a884] transition-all"
                  style={{ width: `${progress.total ? ((progress.total - progress.pending) / progress.total) * 100 : 100}%` }}
                />
              </div>
              <div className="flex items-center gap-2">
                {done ? <CheckCircle2 className="size-5 text-[#008069]" /> : <Loader2 className="size-5 animate-spin text-[#00a884]" />}
                <span>
                  {progress.sent} enviados · {progress.skipped} sin enviar · {progress.failed} fallaron
                  {!done && ` · faltan ${progress.pending}`}
                </span>
              </div>
              {progress.notice && <p className="text-xs text-destructive">{progress.notice}</p>}
              {done && (
                <p className="text-xs text-muted-foreground">
                  Cada mensaje quedó en el chat de esa persona (WhatsApp → Chats), con sus ✓✓ de entregado y leído.
                </p>
              )}
              {done && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-full bg-[#00a884] px-4 font-medium text-white">
                    Listo
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </CrmModal>
    </>
  );
};

export default WhatsAppBulkSend;
