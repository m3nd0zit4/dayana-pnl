"use client";

import { Mail, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";

type CampaignRow = {
  id: string;
  name: string;
  templateKey: string;
  status: string;
  totalTargets: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  workshopTitle: string | null;
};

type Props = {
  preview: boolean;
  campaigns: CampaignRow[];
  staffEmail?: string;
};

const campaignStatusLabel = (status: string) => {
  switch (status) {
    case "COMPLETED":
      return "Completada";
    case "RUNNING":
      return "En proceso";
    case "DRAFT":
      return "Borrador";
    default:
      return status;
  }
};

const NotificationsPageClient = ({
  preview,
  campaigns,
  staffEmail,
}: Props) => {
  const router = useRouter();
  const { toast, dismissToast, canWrite } = useCrm();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const hasRunning = campaigns.some((c) => c.status === "RUNNING");

  useEffect(() => {
    if (!hasRunning || preview) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [hasRunning, preview, router]);

  const sendPreview = async () => {
    if (!subject.trim() || !message.trim()) {
      toast("Escribe asunto y mensaje", "error");
      return;
    }
    setSending(true);
    const loadingId = toast({
      title: "En proceso",
      message: "Enviando correo de prueba…",
      variant: "loading",
    });
    try {
      const res = await fetch("/api/admin/notifications/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      dismissToast(loadingId);
      if (!res.ok) {
        toast({
          title: "No se pudo enviar",
          message:
            data.error === "email_not_configured"
              ? "Falta conectar el correo en el servidor (SMTP o Resend)"
              : String(data.error ?? "Error desconocido"),
          variant: "error",
        });
        return;
      }
      toast({
        title: data.dryRun ? "Modo prueba" : "Correo enviado",
        message: data.dryRun
          ? "Revisa la consola del servidor — no se envió correo real."
          : `Llegó a ${data.to}`,
        variant: data.dryRun ? "info" : "success",
      });
    } finally {
      dismissToast(loadingId);
      setSending(false);
    }
  };

  return (
    <CrmPageShell>
      <div className="space-y-8">
        <div>
          <h1 className="crm-section-title text-xl">Notificaciones</h1>
          <p className="crm-section-subtitle mt-1 max-w-xl">
            Envía correos con la imagen de Dayana Beltrán PNL. Redacta el mensaje,
            envíatelo a ti misma para revisarlo y luego anuncia talleres a tus
            contactos.
          </p>
        </div>

        {hasRunning && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            Hay campañas en proceso — esta página se actualiza cada pocos segundos.
          </p>
        )}

        {!preview && canWrite && (
          <section className="crm-surface-card space-y-4 p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--crm-linen)]/80 text-[var(--crm-accent)]">
                <Mail className="size-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Enviar por correo</h2>
                <p className="mt-1 text-xs leading-relaxed text-[var(--crm-muted)]">
                  El mensaje llegará a{" "}
                  <strong className="text-[var(--crm-foreground)]">
                    {staffEmail ?? "tu correo de staff"}
                  </strong>{" "}
                  con el diseño de la marca (mismo estilo que la confirmación de
                  pago). Desde{" "}
                  <span className="text-[var(--crm-accent)]">
                    contacto@dayanabeltran.com
                  </span>{" "}
                  vía Resend (ver docs/vercel-resend-email.md).
                </p>
              </div>
            </div>

            <div>
              <label className="crm-label" htmlFor="notif-subject">
                Asunto
              </label>
              <input
                id="notif-subject"
                className="crm-input mt-1"
                placeholder="Ej. Nuevo taller virtual — mayo 2026"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            <div>
              <label className="crm-label" htmlFor="notif-body">
                Mensaje
              </label>
              <textarea
                id="notif-body"
                className="crm-textarea mt-1 min-h-[160px] text-sm leading-relaxed"
                placeholder={
                  "Hola,\n\nTe comparto las fechas del próximo taller…\n\nCon cariño,\nDayana"
                }
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="crm-btn-primary"
              disabled={sending}
              onClick={() => void sendPreview()}
            >
              <Send className="size-4" />
              {sending ? "Enviando…" : "Enviarme este correo"}
            </button>
          </section>
        )}

        {!preview && (
          <p className="text-sm text-[var(--crm-muted)]">
            Para avisar a <strong>todos los contactos</strong> de un taller:{" "}
            <Link href="/admin/workshops" className="text-[var(--crm-accent)] underline">
              Talleres
            </Link>{" "}
            → icono del megáfono en la edición.
          </p>
        )}

        <section className="space-y-2">
          <h2 className="crm-font-display text-[10px] uppercase tracking-wide text-[var(--crm-muted)]">
            Envíos recientes
          </h2>
          <ul className="space-y-2">
            {campaigns.length === 0 && (
              <li className="crm-surface-card p-6 text-sm text-[var(--crm-muted)]">
                Aún no hay campañas masivas.
              </li>
            )}
            {campaigns.map((c) => {
              const progress =
                c.totalTargets > 0
                  ? Math.min(100, (c.sentCount / c.totalTargets) * 100)
                  : 0;
              const isRunning = c.status === "RUNNING";

              return (
                <li key={c.id} className="crm-surface-card p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                        isRunning
                          ? "border-sky-200 bg-sky-50 text-sky-800"
                          : "border-[var(--crm-border)] text-[var(--crm-muted)]"
                      }`}
                    >
                      {campaignStatusLabel(c.status)}
                    </span>
                  </div>
                  {c.workshopTitle && (
                    <p className="mt-1 text-xs text-[var(--crm-muted)]">
                      {c.workshopTitle}
                    </p>
                  )}
                  {c.totalTargets > 0 && (isRunning || c.sentCount < c.totalTargets) && (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                        <div
                          className="h-full rounded-full bg-[var(--crm-accent)] transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-[var(--crm-muted)]">
                        {c.sentCount} de {c.totalTargets} enviados
                        {c.failedCount > 0 ? ` · ${c.failedCount} fallidos` : ""}
                        {c.skippedCount > 0 ? ` · ${c.skippedCount} omitidos` : ""}
                      </p>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-[var(--crm-muted)]">
                    {c.sentCount} enviados ·{" "}
                    {new Date(c.createdAt).toLocaleString("es-CO", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </CrmPageShell>
  );
};

export default NotificationsPageClient;
