"use client";



import { EnrollmentStatus } from "@prisma/client";

import Link from "next/link";

import { useCallback, useState } from "react";
import { BookOpen } from "lucide-react";

import RegisterPaymentModal, {
  type RegisteredPayment,
} from "@/app/components/admin/crm/RegisterPaymentModal";

import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import SearchableSelect from "@/app/components/admin/crm/SearchableSelect";
import { enrollmentStatusSelectOptions } from "@/lib/crm/form-select-options";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { contactNotebookPath } from "@/lib/crm/contact-notebook-url";



type Session = {

  id: string;

  sessionNumber: number;

  status: string;

  scheduledAt: string | null;

  meetUrl: string | null;

  durationMinutes: number | null;

};



const sessionStatusLabel = (status: string) => {
  if (status === "PENDING_SCHEDULE") return "Pendiente";
  if (status === "COMPLETED") return "Completada";
  if (status === "NO_SHOW") return "No asistió";
  if (status === "SCHEDULED") return "Agendada";
  if (status === "RESCHEDULED") return "Reagendada";
  if (status === "CANCELLED") return "Cancelada";
  return status;
};



const sectionHeading =

  "mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--crm-muted)]";



const EnrollmentDetailClient = ({

  enrollment: initial,

}: {

  enrollment: {

    id: string;

    status: string;

    sessionsTotal: number | null;

    sessionsUsed: number;

    amountMinor: number | null;

    currency: string | null;

    contact: { id: string; firstName: string; phoneE164: string; timezone: string };

    product: { title: string; kind: string };

    therapyPackage: {

      id: string;

      totalSessions: number;

      usedSessions: number;

      meetDefaultUrl: string | null;

      reprogrammingNotes: string | null;

      sessions: Session[];

    } | null;

    payments: {

      id: string;

      status: string;

      amountMinor: number;

      currency: string;

      provider: string;

    }[];

  };

}) => {

  const { canWrite, canEditNotes, toast, confirm } = useCrm();

  const [enrollment, setEnrollment] = useState(initial);

  const [busy, setBusy] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);

  const pkg = enrollment.therapyPackage;



  const refreshPackage = useCallback(async () => {

    const res = await fetch(

      `/api/admin/therapy/sessions?enrollmentId=${enrollment.id}`

    );

    const data = (await res.json()) as {

      therapyPackage?: typeof initial.therapyPackage;

    };

    if (data.therapyPackage) {

      setEnrollment((e) => ({

        ...e,

        therapyPackage: {

          ...data.therapyPackage!,

          sessions: data.therapyPackage!.sessions.map((s) => ({

            ...s,

            scheduledAt:

              typeof s.scheduledAt === "string"

                ? s.scheduledAt

                : s.scheduledAt

                  ? new Date(s.scheduledAt as unknown as string).toISOString()

                  : null,

          })),

        },

      }));

    }

  }, [enrollment.id]);



  const patchEnrollment = async (status: EnrollmentStatus) => {
    const prevStatus = enrollment.status;
    if (prevStatus === status) return;

    setEnrollment((e) => ({ ...e, status }));

    const res = await fetch(`/api/admin/enrollments/${enrollment.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });

    const data = (await res.json()) as { enrollment?: typeof enrollment; error?: string };

    if (!res.ok) {
      setEnrollment((e) => ({ ...e, status: prevStatus }));
      if (data.error === "ACTIVE_THERAPY_EXISTS") {
        toast("Este contacto ya tiene otra terapia activa", "error");
      } else {
        toast(data.error ?? "No se pudo actualizar el estado", "error");
      }
      return;
    }

    if (data.enrollment) {
      setEnrollment((e) => ({ ...e, status: data.enrollment!.status }));
    }
    toast(`Estado cambiado a «${enrollmentStatusLabel(status)}»`);
    void refreshPackage();
  };



  const completeSession = (sessionId: string, sessionNumber: number) => {
    if (!pkg || sessionId.startsWith("placeholder")) return;

    confirm({
      title: `Completar sesión ${sessionNumber}`,
      message: "¿Marcar esta sesión como completada?",
      onConfirm: async () => {
        setBusy(true);
        const res = await fetch("/api/admin/therapy/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "complete",
            sessionId,
            therapyPackageId: pkg.id,
            sessionNumber,
          }),
        });
        setBusy(false);

        if (res.ok) {
          toast({
            message: "Sesión completada",
            variant: "success",
            duration: 8000,
            action: canEditNotes
              ? {
                  label: `Añadir hoja de sesión ${sessionNumber}`,
                  href: contactNotebookPath(enrollment.contact.id, {
                    newPage: true,
                    sessionId,
                  }),
                }
              : undefined,
          });
          void refreshPackage();
        } else {
          toast("Error al completar", "error");
        }
      },
    });
  };



  const handlePaymentSuccess = (payment: RegisteredPayment) => {
    setEnrollment((e) => ({
      ...e,
      status: EnrollmentStatus.ACTIVE,
      payments: [
        {
          id: payment.id,
          status: payment.status,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          provider: payment.provider,
        },
        ...e.payments,
      ],
    }));
    void refreshPackage();
  };

  const hasApprovedPayment = enrollment.payments.some((p) => p.status === "APPROVED");
  const needsPayment =
    canWrite &&
    !hasApprovedPayment &&
    (enrollment.status === EnrollmentStatus.LEAD ||
      enrollment.status === EnrollmentStatus.PENDING_PAYMENT);

  const progress =

    pkg && pkg.totalSessions > 0

      ? (pkg.usedSessions / pkg.totalSessions) * 100

      : enrollment.sessionsTotal

        ? (enrollment.sessionsUsed / enrollment.sessionsTotal) * 100

        : 0;



  const allSessions =

    pkg?.sessions.length

      ? pkg.sessions

      : pkg

        ? Array.from({ length: pkg.totalSessions }, (_, i) => ({

            id: `placeholder-${i + 1}`,

            sessionNumber: i + 1,

            status: "PENDING_SCHEDULE",

            scheduledAt: null,

            meetUrl: null,

            durationMinutes: 60,

          }))

        : [];



  return (

    <div className="space-y-8">

      <div>

        <h1 className="text-xl font-semibold tracking-tight">

          {enrollment.product.title}

        </h1>

        <p className="mt-2 text-sm text-[var(--crm-muted)]">

          <Link

            href={`/admin/contacts/${enrollment.contact.id}`}

            className="text-[var(--crm-accent)] hover:underline"

          >

            {enrollment.contact.firstName}

          </Link>{" "}

          · {enrollment.contact.phoneE164}

        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">

          <label className="text-xs text-[var(--crm-muted)]">Estado</label>

          <SearchableSelect
            label="Estado"
            hideLabel
            value={enrollment.status}
            options={enrollmentStatusSelectOptions()}
            onChange={(next) => {
              const status = next as EnrollmentStatus;
              if (status === enrollment.status) return;
              if (status === EnrollmentStatus.CANCELLED) {
                confirm({
                  title: "Cancelar servicio",
                  message: "¿Marcar este enrollment como cancelado?",
                  onConfirm: () => patchEnrollment(status),
                });
              } else {
                void patchEnrollment(status);
              }
            }}
            disabled={!canWrite}
            className="w-auto min-w-[160px]"
            menuVariant="status"
            panelMinWidth={200}

            searchMinOptions={99}

          />

          {canEditNotes && (
            <Link
              href={contactNotebookPath(enrollment.contact.id)}
              className="crm-btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              <BookOpen className="size-3.5" aria-hidden />
              Cuaderno
            </Link>
          )}

          {enrollment.sessionsTotal != null && (

            <span className="text-xs text-[var(--crm-muted)]">

              Sesiones {enrollment.sessionsUsed}/{enrollment.sessionsTotal}

            </span>

          )}


        </div>

        <div className="mt-3 h-2 max-w-md overflow-hidden rounded-full bg-black/[0.06]">

          <div

            className="h-full rounded-full bg-[var(--crm-accent)] transition-all"

            style={{ width: `${Math.min(100, progress)}%` }}

          />

        </div>

      </div>

      {canWrite && (
        <section className="crm-surface-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className={sectionHeading}>Pago del servicio</h2>
              {hasApprovedPayment ? (
                <p className="text-sm text-[var(--crm-muted)]">
                  {enrollment.payments.length} pago(s) registrado(s)
                </p>
              ) : (
                <p className="text-sm text-[var(--crm-muted)]">
                  Sin pago aún
                  {enrollment.amountMinor
                    ? ` · precio referencia $${(enrollment.amountMinor / 100).toFixed(2)} ${enrollment.currency ?? "USD"}`
                    : ""}
                </p>
              )}
            </div>
            <button
              type="button"
              className="crm-btn-primary text-xs"
              disabled={busy}
              onClick={() => setPaymentOpen(true)}
            >
              {hasApprovedPayment ? "Registrar otro pago" : "Registrar pago"}
            </button>
          </div>

          {needsPayment && (
            <p className="mt-3 rounded-lg border border-[var(--crm-blush-soft)] bg-[var(--crm-blush-soft)]/40 px-3 py-2 text-xs text-[var(--crm-accent)]">
              Tip: al registrar el pago el servicio se activa solo — no hace falta cambiar el estado a mano.
            </p>
          )}

          {enrollment.payments.length > 0 && (
            <ul className="mt-4 divide-y divide-[var(--crm-border)] text-sm">
              {enrollment.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2.5 first:pt-0">
                  <span className="text-[var(--crm-muted)]">
                    {p.provider} · {p.status}
                  </span>
                  <span className="font-medium">
                    {(p.amountMinor / 100).toFixed(2)} {p.currency}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {pkg && (
        <section className="crm-surface-card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={sectionHeading}>Sesiones</h2>
            <p className="text-xs text-[var(--crm-muted)]">
              Agenda en Google Calendar
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--crm-border)] text-[10px] uppercase text-[var(--crm-muted)]">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Estado</th>
                  <th className="py-2">Acción</th>
                </tr>
              </thead>
              <tbody>
                {allSessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    canWrite={canWrite}
                    busy={busy}
                    onComplete={() => completeSession(s.id, s.sessionNumber)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}



      <RegisterPaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        enrollmentId={enrollment.id}
        productTitle={enrollment.product.title}
        contactName={enrollment.contact.firstName}
        suggestedAmountMinor={enrollment.amountMinor}
        currency={enrollment.currency ?? "USD"}
        onSuccess={handlePaymentSuccess}
      />

    </div>

  );

};



const SessionRow = ({
  session: s,
  canWrite,
  busy,
  onComplete,
}: {
  session: Session;
  canWrite: boolean;
  busy: boolean;
  onComplete: () => void;
}) => {
  const isCompleted = s.status === "COMPLETED";
  const canComplete =
    canWrite && !isCompleted && !s.id.startsWith("placeholder");

  return (
    <tr className="border-b border-black/[0.04] align-middle">
      <td className="py-2.5 pr-2 font-medium">{s.sessionNumber}</td>
      <td className="py-2.5 pr-2 text-xs">{sessionStatusLabel(s.status)}</td>
      <td className="py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          {canComplete && (
            <button
              type="button"
              disabled={busy}
              className="crm-btn-primary text-xs"
              onClick={onComplete}
            >
              Completar
            </button>
          )}
          {isCompleted && (
            <span className="text-xs text-[var(--crm-muted)]">Completada</span>
          )}
        </div>
      </td>
    </tr>
  );
};



export default EnrollmentDetailClient;

