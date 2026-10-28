"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Send } from "lucide-react";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/components/ui/collapsible";
import { Progress } from "@/app/components/ui/progress";
import CrmModal from "../CrmModal";
import { useCrm } from "../CrmProvider";
import { CrmDataList, CrmDataListRow, CrmFormActions, CrmLoadingState } from "../ui";

/** Lo que devuelve `previewWorkshopInvite` (más si quien mira puede enviar). */
type Preview = {
  blocked: string | null;
  windowDays: number;
  events: { headline: string; startsAtIso: string | null; people: number }[];
  registered: number;
  eligible: number;
  viaText: number;
  viaTemplate: number;
  template: { key: string; status: string | null; approved: boolean };
  sendableNow: number;
  estimatedCost: number;
  currency: string;
  excluded: { reason: string; label: string; count: number }[];
  sample: { name: string | null; via: "text" | "template" }[];
  textExample: string;
  inProgress: { sendId: string; pending: number } | null;
  canSend: boolean;
};

type SendProgress = {
  status: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  /** No hubo nada que enviar y quedan filas «enviándose» (otra ventana, o un intento que se cortó). */
  stalled?: boolean;
  notice?: string;
};

/** Un respiro entre tandas, y cuántas seguidas sin avanzar antes de parar (revisión 28-oct: giraba sin fin). */
const STEP_DELAY_MS = 400;
const MAX_IDLE_STEPS = 2;
const STALLED_MESSAGE =
  "El envío no avanza: puede que esté saliendo desde otra ventana o que un intento se haya cortado. Vuelve a tocar el botón en unos minutos: a nadie le llega dos veces.";

export type InvitationView = {
  contactId: string;
  name: string | null;
  phone: string | null;
  conversationId: string | null;
  status: string;
  mode: "text" | "template" | null;
  atIso: string | null;
  error: string | null;
  answeredAtIso: string | null;
};

const STATUS: Record<string, { label: string; tone: "outline" | "secondary" | "destructive" }> = {
  SENT: { label: "Invitada", tone: "secondary" },
  FAILED: { label: "No le llegó", tone: "destructive" },
  NEEDS_TEMPLATE: { label: "Espera la plantilla", tone: "outline" },
  SKIPPED: { label: "No se envió", tone: "outline" },
  OPTED_OUT: { label: "Pidió no recibir WhatsApp", tone: "outline" },
  NO_PHONE: { label: "Sin número", tone: "outline" },
};

const n = (x: number) => x.toLocaleString("es-CO");

const readMessage = async (res: Response | null, fallback: string) => {
  const data = (await res?.json().catch(() => null)) as { message?: string } | null;
  return data?.message || fallback;
};

/**
 * «Invitar a inscritas de eventos gratuitos» (dueña, 28-oct): a quienes se
 * inscribieron en un evento gratuito y aceptaron recibir información de
 * talleres, la IA les escribe que el taller es de pago, cuándo es, y les
 * pregunta si separan su cupo o agendan una llamada con Dayana. Primero se ve
 * a cuántas les llega y por qué a las demás no; se envía tras confirmar, por
 * tandas. Quien responde entra en «Interesadas» (abajo).
 */
const WorkshopFreeEventInvite = ({
  slug,
  timeZone,
  open,
  invitations,
}: {
  slug: string;
  timeZone: string;
  /** Inscripciones abiertas: solo entonces se invita. */
  open: boolean;
  invitations: InvitationView[];
}) => {
  const { canWrite, toast, confirm } = useCrm();
  const router = useRouter();
  const [dialog, setDialog] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [sendId, setSendId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const url = `/api/admin/workshops/${encodeURIComponent(slug)}/invite`;
  const post = (body: unknown) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("es-CO", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const day = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { timeZone, day: "numeric", month: "long" });

  const sent = invitations.filter((i) => i.status === "SENT");
  const answered = sent.filter((i) => i.answeredAtIso);

  const openPreview = async () => {
    setDialog(true);
    setPreview(null);
    setLoadError(null);
    setProgress(null);
    const res = await post({ action: "preview" });
    if (!res?.ok) {
      setLoadError(await readMessage(res, "No se pudo calcular a quién le llega. Inténtalo de nuevo."));
      return;
    }
    setPreview((await res.json()) as Preview);
  };

  const run = async (p: Preview) => {
    setRunning(true);
    try {
      // Lo que Dayana vio y confirmó: si al empezar no cuadra (alguien escribió, pagó, o Meta
      // aprobó la plantilla entre medias), el servidor no empieza y se vuelve a mirar.
      const started = await post({
        action: "start",
        expect: { viaText: p.viaText, viaTemplate: p.viaTemplate, includeTemplate: p.template.approved },
      });
      if (!started?.ok) {
        toast(await readMessage(started, "No se pudo preparar la invitación."), "error");
        if (started?.status === 409) void openPreview();
        return;
      }
      const data = (await started.json()) as { status: "started"; sendId: string; total: number } | { status: "in_progress"; sendId: string; pending: number };
      setSendId(data.sendId);
      let last: SendProgress | null = null;
      let idle = 0;
      for (;;) {
        const step = await post({ action: "next", sendId: data.sendId });
        if (!step?.ok) throw new Error(await readMessage(step, ""));
        const next = (await step.json()) as SendProgress;
        const moved = !last || next.pending !== last.pending || next.sent + next.failed + next.skipped !== last.sent + last.failed + last.skipped;
        last = next;
        setProgress(last);
        if (last.pending === 0 || last.status === "DONE" || last.status === "CANCELLED") break;
        idle = moved && !last.stalled ? 0 : idle + 1;
        if (idle >= MAX_IDLE_STEPS) break;
        await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      }
      if (last && last.pending > 0 && last.status === "SENDING") toast(STALLED_MESSAGE, "error");
      else if (last?.notice) toast(last.notice, "error");
      else if (last?.status === "CANCELLED") toast("Invitación detenida: a las que faltaban no se les escribió.", "info");
      else toast(`Invitación enviada a ${n(last?.sent ?? 0)} ${last?.sent === 1 ? "persona" : "personas"}.`);
      router.refresh();
    } catch (e) {
      toast(
        e instanceof Error && e.message
          ? e.message
          : "La invitación se interrumpió. Vuelve a tocar el botón: sigue donde quedó y a nadie le llega dos veces.",
        "error"
      );
    } finally {
      setRunning(false);
    }
  };

  const stop = async () => {
    if (!sendId) return;
    const res = await post({ action: "cancel", sendId });
    if (!res?.ok) toast("No se pudo detener.", "error");
  };

  const askSend = (p: Preview) =>
    confirm({
      title: p.inProgress
        ? `¿Seguir con la invitación? Faltan ${n(p.inProgress.pending)}`
        : `¿Enviar la invitación a ${n(p.sendableNow)} ${p.sendableNow === 1 ? "persona" : "personas"}?`,
      message: `La IA les escribe por WhatsApp como la asistente de Dayana: que es un taller de pago (el valor lo ven en el enlace), cuándo es, y si quieren separar su cupo o agendar una llamada con Dayana. ${
        p.inProgress
          ? ""
          : `${n(p.viaText)} por mensaje (gratis)${p.template.approved && p.viaTemplate > 0 ? ` y ${n(p.viaTemplate)} con la plantilla (Meta la cobra)` : ""}. `
      }Antes de escribirle a cada una se vuelve a comprobar que pueda recibirla.`,
      confirmLabel: p.inProgress ? "Seguir" : "Enviar",
      onConfirm: () => {
        void run(p);
      },
    });

  /** La plantilla a Meta: solo la dueña, y solo si nunca se mandó o la rechazaron. */
  const submitTemplate = async () => {
    setSubmitting(true);
    const res = await post({ action: "submit_template" });
    setSubmitting(false);
    if (!res?.ok) {
      toast(await readMessage(res, "No se pudo mandar la plantilla a aprobar."), "error");
      return;
    }
    const data = (await res.json()) as { status: "submitted" | "already" };
    toast(data.status === "submitted" ? "Plantilla enviada a Meta: te avisa el CRM cuando la aprueben." : "La plantilla ya está en revisión en Meta.");
    void openPreview();
  };
  const canSubmitTemplate = (p: Preview) =>
    p.canSend && !p.template.approved && (!p.template.status || p.template.status.toUpperCase().startsWith("REJECTED"));

  const done = progress && progress.pending === 0;
  const blockedReason = !open ? "El taller no tiene las inscripciones abiertas." : null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-sm font-medium">Inscritas de eventos gratuitos</h2>
          <p className="text-xs text-muted-foreground">
            Quienes se inscribieron en un evento gratuito y aceptaron recibir información de talleres. La IA les escribe
            que es un taller de pago, cuándo es, y les pregunta si separan su cupo con el enlace de pago o agendan una
            llamada con Dayana. Quien responde aparece en «Interesadas».
          </p>
        </div>
        {canWrite ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void openPreview()} disabled={Boolean(blockedReason) || running} title={blockedReason ?? undefined}>
            <Send aria-hidden />
            Invitar a inscritas de eventos gratuitos
          </Button>
        ) : null}
      </div>

      {invitations.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline">
            <ChevronDown aria-hidden className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
            Invitadas ({n(sent.length)}){answered.length > 0 ? ` · respondieron ${n(answered.length)}` : ""}
            {invitations.length > sent.length ? ` · sin enviar ${n(invitations.length - sent.length)}` : ""}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CrmDataList className="mt-2">
              {invitations.map((i) => {
                const st = STATUS[i.status] ?? { label: i.status, tone: "outline" as const };
                const name = i.name ?? i.phone ?? "Sin nombre";
                return (
                  <CrmDataListRow key={i.contactId}>
                    <div className="min-w-0 flex-1 basis-56">
                      {i.conversationId ? (
                        <Link href={`/admin/whatsapp?conversation=${i.conversationId}`} className="font-medium text-foreground hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <span className="font-medium">{name}</span>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[i.name ? i.phone : null, i.atIso ? when(i.atIso) : null, i.mode === "template" ? "con la plantilla" : i.mode === "text" ? "por mensaje" : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {i.error && i.status !== "SENT" ? <p className="mt-0.5 text-xs text-muted-foreground">{i.error}</p> : null}
                    </div>
                    <p className="flex flex-wrap gap-1.5">
                      <Badge variant={st.tone}>{st.label}</Badge>
                      {i.answeredAtIso ? <Badge variant="outline">Respondió · {when(i.answeredAtIso)}</Badge> : null}
                    </p>
                  </CrmDataListRow>
                );
              })}
            </CrmDataList>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <CrmModal title="Invitar a inscritas de eventos gratuitos" open={dialog} onClose={() => !running && setDialog(false)} large>
        <div className="space-y-3 text-sm">
          {loadError ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : !preview ? (
            <CrmLoadingState rows={4} />
          ) : (
            <>
              {preview.blocked ? (
                <Alert variant="warning">
                  <AlertDescription>{preview.blocked}</AlertDescription>
                </Alert>
              ) : null}
              <div className="space-y-1">
                <p>
                  Le llega a <span className="font-medium">{n(preview.eligible)}</span> de {n(preview.registered)}{" "}
                  {preview.registered === 1 ? "persona inscrita" : "personas inscritas"} en eventos gratuitos de los últimos {preview.windowDays} días.
                </p>
                {preview.events.length > 0 ? (
                  <ul className="text-xs text-muted-foreground">
                    {preview.events.map((e) => (
                      <li key={`${e.headline}-${e.startsAtIso}`}>
                        {e.headline}
                        {e.startsAtIso ? ` · ${day(e.startsAtIso)}` : ""} · {n(e.people)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {preview.eligible > 0 ? (
                <div className="space-y-1 rounded-lg bg-muted/60 p-3">
                  <p>
                    {n(preview.viaText)} por mensaje (escribieron en las últimas 24 h, gratis)
                    {preview.viaTemplate > 0 ? ` · ${n(preview.viaTemplate)} con la plantilla` : ""}.
                  </p>
                  {preview.viaTemplate > 0 ? (
                    preview.template.approved ? (
                      <p className="text-xs text-muted-foreground">
                        La plantilla es de Marketing: Meta la cobra
                        {preview.estimatedCost > 0 ? `, unos ${preview.currency} ${preview.estimatedCost.toFixed(2)} en total` : ""}.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-xs text-warning">
                          {n(preview.viaTemplate)} no escribieron en las últimas 24 h y la plantilla «Invitación a inscritas de eventos
                          gratuitos» todavía no está aprobada por Meta
                          {preview.template.status ? ` (${preview.template.status.toLowerCase()})` : " (no se ha mandado a revisión)"}.
                          Les llega cuando Meta la apruebe y vuelvas a tocar el botón.
                        </p>
                        {canSubmitTemplate(preview) ? (
                          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => void submitTemplate()}>
                            {submitting ? "Mandando…" : "Mandar la plantilla a aprobar"}
                          </Button>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </div>
              ) : null}

              {preview.excluded.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium">No le llega a</p>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {preview.excluded.map((e) => (
                      <li key={e.reason}>
                        {n(e.count)} · {e.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Así le llega a quien escribió en las últimas 24 h (con su nombre solo si es seguro). La IA sigue lo que conteste: el
                  enlace de pago o las horas para la llamada.
                </p>
                <p className="rounded-lg bg-muted/60 p-3 whitespace-pre-wrap">{preview.textExample}</p>
              </div>

              {progress ? (
                <div className="space-y-1.5">
                  <Progress value={progress.total ? Math.round(((progress.total - progress.pending) / progress.total) * 100) : 100} />
                  <p className="text-xs text-muted-foreground">
                    Enviadas {n(progress.sent)} · no se enviaron {n(progress.skipped)} · fallaron {n(progress.failed)} de {n(progress.total)}
                  </p>
                </div>
              ) : null}

              {!preview.canSend ? (
                <p className="text-xs text-muted-foreground">Solo la dueña puede enviar la invitación.</p>
              ) : null}

              <CrmFormActions>
                {running ? (
                  <Button type="button" variant="outline" onClick={() => void stop()}>
                    Detener
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setDialog(false)}>
                    {done ? "Cerrar" : "Cancelar"}
                  </Button>
                )}
                {!done ? (
                  <Button
                    type="button"
                    disabled={running || !preview.canSend || Boolean(preview.blocked) || (preview.sendableNow === 0 && !preview.inProgress)}
                    onClick={() => askSend(preview)}
                  >
                    {running
                      ? "Enviando…"
                      : preview.inProgress
                        ? `Seguir (faltan ${n(preview.inProgress.pending)})`
                        : `Enviar a ${n(preview.sendableNow)}`}
                  </Button>
                ) : null}
              </CrmFormActions>
            </>
          )}
        </div>
      </CrmModal>
    </section>
  );
};

export default WorkshopFreeEventInvite;
