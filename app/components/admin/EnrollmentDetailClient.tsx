"use client";



import { EnrollmentStatus } from "@prisma/client";

import Link from "next/link";

import { useCallback, useState } from "react";

import CrmModal from "@/app/components/admin/crm/CrmModal";
import RegisterPaymentModal, {
  type RegisteredPayment,
} from "@/app/components/admin/crm/RegisterPaymentModal";

import ScheduleSessionModal, {

  toLocalInput,

} from "@/app/components/admin/crm/ScheduleSessionModal";

import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import SearchableSelect from "@/app/components/admin/crm/SearchableSelect";
import { enrollmentStatusSelectOptions } from "@/lib/crm/form-select-options";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";



type Session = {

  id: string;

  sessionNumber: number;

  status: string;

  scheduledAt: string | null;

  meetUrl: string | null;

  durationMinutes: number | null;

};



const sessionStatusLabel = (status: string) => {

  if (status === "PENDING_SCHEDULE") return "Pendiente de agendar";

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

  const [meetDefaultUrl, setMeetDefaultUrl] = useState(

    initial.therapyPackage?.meetDefaultUrl ?? ""

  );

  const [reprogrammingNotes, setReprogrammingNotes] = useState(

    initial.therapyPackage?.reprogrammingNotes ?? ""

  );

  const [busy, setBusy] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [scheduleSessionNumber, setScheduleSessionNumber] = useState(1);

  const [completeOpen, setCompleteOpen] = useState(false);

  const [completeSessionId, setCompleteSessionId] = useState<string | null>(null);

  const [completeNote, setCompleteNote] = useState("");

  const pkg = enrollment.therapyPackage;

  const tz = enrollment.contact.timezone;



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



  const savePackageMeta = async () => {

    if (!pkg) return;

    setBusy(true);

    const res = await fetch("/api/admin/therapy/package", {

      method: "PATCH",

      headers: { "content-type": "application/json" },

      body: JSON.stringify({

        therapyPackageId: pkg.id,

        meetDefaultUrl: meetDefaultUrl || null,

        reprogrammingNotes: reprogrammingNotes || null,

      }),

    });

    setBusy(false);

    if (res.ok) toast("Paquete de terapia guardado");

    else toast("Error al guardar paquete", "error");

  };



  const openSchedule = (sessionNumber: number) => {

    setScheduleSessionNumber(sessionNumber);

    setScheduleOpen(true);

  };



  const nextPendingSession = () => {

    const pending = pkg?.sessions.find((s) => s.status === "PENDING_SCHEDULE");

    return pending?.sessionNumber ?? (pkg?.usedSessions ?? 0) + 1;

  };



  const patchSession = async (

    sessionId: string,

    body: Record<string, unknown>

  ) => {

    setBusy(true);

    const res = await fetch("/api/admin/therapy/sessions", {

      method: "PATCH",

      headers: { "content-type": "application/json" },

      body: JSON.stringify({ sessionId, ...body }),

    });

    setBusy(false);

    if (res.ok) {

      toast("Sesión actualizada");

      void refreshPackage();

    } else {

      const d = (await res.json()) as { error?: string };

      toast(d.error ?? "Error", "error");

    }

  };



  const submitComplete = async () => {

    if (!completeSessionId || !pkg) return;

    setBusy(true);

    const res = await fetch("/api/admin/therapy/sessions", {

      method: "POST",

      headers: { "content-type": "application/json" },

      body: JSON.stringify({

        action: "complete",

        sessionId: completeSessionId,

        therapyPackageId: pkg.id,

        sessionNumber: 1,

        noteText: completeNote || undefined,

      }),

    });

    setBusy(false);

    if (res.ok) {

      toast("Sesión completada");

      setCompleteOpen(false);

      setCompleteNote("");

      setCompleteSessionId(null);

      void refreshPackage();

    } else toast("Error al completar", "error");

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

          {canEditNotes && (

            <>

              {" "}

              ·{" "}

              <Link

                href={`/admin/contacts/${enrollment.contact.id}?tab=notas`}

                className="text-[var(--crm-accent)] hover:underline"

              >

                Notas clínicas

              </Link>

            </>

          )}

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

          {enrollment.sessionsTotal != null && (

            <span className="text-xs text-[var(--crm-muted)]">

              Sesiones {enrollment.sessionsUsed}/{enrollment.sessionsTotal}

            </span>

          )}

          {canWrite && pkg && (

            <Link

              href="/admin/calendar"

              className="text-xs font-medium text-[var(--crm-accent)] hover:underline"

            >

              Ver calendario →

            </Link>

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

          <h2 className={sectionHeading}>Terapia 1:1</h2>



          <div className="grid gap-3 sm:grid-cols-2">

            <div>

              <label className="crm-label">Meet por defecto</label>

              <input

                className="crm-input"

                value={meetDefaultUrl}

                disabled={!canWrite}

                onChange={(e) => setMeetDefaultUrl(e.target.value)}

                placeholder="https://meet.google.com/..."

              />

            </div>

            <div className="sm:col-span-2">

              <label className="crm-label">Notas de reprogramación</label>

              <textarea

                className="crm-textarea min-h-[80px]"

                value={reprogrammingNotes}

                disabled={!canWrite}

                onChange={(e) => setReprogrammingNotes(e.target.value)}

                placeholder="Acuerdos de reprogramación del paquete…"

              />

            </div>

          </div>

          {canWrite && (

            <button

              type="button"

              disabled={busy}

              onClick={() => void savePackageMeta()}

              className="crm-btn-secondary text-xs"

            >

              Guardar enlace y notas del paquete

            </button>

          )}



          <div className="overflow-x-auto">

            <table className="w-full text-left text-sm">

              <thead>

                <tr className="border-b border-[var(--crm-border)] text-[10px] uppercase text-[var(--crm-muted)]">

                  <th className="py-2 pr-2">#</th>

                  <th className="py-2 pr-2">Estado</th>

                  <th className="py-2 pr-2">Fecha</th>

                  <th className="py-2 pr-2">Meet</th>

                  <th className="py-2">Acciones</th>

                </tr>

              </thead>

              <tbody>

                {allSessions.map((s) => (

                  <SessionRow

                    key={s.id}

                    session={s}

                    tz={tz}

                    canWrite={canWrite}

                    busy={busy}

                    onPatch={patchSession}

                    onSchedule={() => openSchedule(s.sessionNumber)}

                    onComplete={() => {

                      setCompleteSessionId(s.id);

                      setCompleteNote("");

                      setCompleteOpen(true);

                    }}

                    onNoShow={(id) =>

                      confirm({

                        title: "No-show",

                        message: `¿Marcar sesión ${s.sessionNumber} como no asistió?`,

                        onConfirm: () => patchSession(id, { action: "no_show" }),

                      })

                    }

                  />

                ))}

              </tbody>

            </table>

          </div>



          {canWrite && (

            <div className="border-t border-[var(--crm-border)] pt-4">

              <button

                type="button"

                className="crm-btn-primary text-xs"

                onClick={() => openSchedule(nextPendingSession())}

              >

                Agendar sesión

              </button>

            </div>

          )}

        </section>

      )}



      {pkg && (

        <ScheduleSessionModal

          open={scheduleOpen}

          onClose={() => setScheduleOpen(false)}

          onScheduled={() => void refreshPackage()}

          therapyPackageId={pkg.id}

          sessionNumber={scheduleSessionNumber}

          meetDefaultUrl={meetDefaultUrl || pkg.meetDefaultUrl}

          contactTimezone={tz}

          contactName={enrollment.contact.firstName}

          productTitle={enrollment.product.title}

        />

      )}



      <CrmModal

        open={completeOpen}

        title="Completar sesión"

        onClose={() => setCompleteOpen(false)}

      >

        <div className="space-y-4 text-sm">

          <p className="text-[var(--crm-muted)]">

            Opcional: añade una nota clínica vinculada al contacto.

          </p>

          <textarea

            className="crm-textarea min-h-[120px]"

            value={completeNote}

            onChange={(e) => setCompleteNote(e.target.value)}

            placeholder="Notas de la sesión…"

            disabled={!canEditNotes}

          />

          <div className="flex justify-end gap-2">

            <button

              type="button"

              className="crm-btn-secondary"

              onClick={() => setCompleteOpen(false)}

            >

              Cancelar

            </button>

            <button

              type="button"

              className="crm-btn-primary"

              disabled={busy}

              onClick={() => void submitComplete()}

            >

              Completar sesión

            </button>

          </div>

        </div>

      </CrmModal>



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

  tz,

  canWrite,

  busy,

  onPatch,

  onSchedule,

  onComplete,

  onNoShow,

}: {

  session: Session;

  tz: string;

  canWrite: boolean;

  busy: boolean;

  onPatch: (id: string, body: Record<string, unknown>) => void;

  onSchedule: () => void;

  onComplete: () => void;

  onNoShow: (id: string) => void;

}) => {

  const [localAt, setLocalAt] = useState(toLocalInput(s.scheduledAt, tz));

  const [localMeet, setLocalMeet] = useState(s.meetUrl ?? "");



  const isPending = s.status === "PENDING_SCHEDULE";

  const isScheduled = s.status === "SCHEDULED" || s.status === "RESCHEDULED";



  return (

    <tr className="border-b border-black/[0.04] align-top">

      <td className="py-2 pr-2 font-medium">{s.sessionNumber}</td>

      <td className="py-2 pr-2 text-xs">{sessionStatusLabel(s.status)}</td>

      <td className="py-2 pr-2">

        {canWrite && isScheduled ? (

          <input

            type="datetime-local"

            className="crm-input min-w-[160px] text-xs"

            value={localAt}

            onChange={(e) => setLocalAt(e.target.value)}

            onBlur={() => {

              if (!localAt) return;

              onPatch(s.id, {

                scheduledAt: new Date(localAt).toISOString(),

              });

            }}

          />

        ) : isPending ? (

          <span className="text-xs italic text-[var(--crm-muted)]">

            Pendiente de agendar

          </span>

        ) : (

          <span className="text-xs">

            {s.scheduledAt

              ? new Date(s.scheduledAt).toLocaleString("es-CO", { timeZone: tz })

              : "—"}

          </span>

        )}

      </td>

      <td className="py-2 pr-2">

        {canWrite && isScheduled ? (

          <input

            className="crm-input min-w-[120px] text-xs"

            value={localMeet}

            onChange={(e) => setLocalMeet(e.target.value)}

            onBlur={() => onPatch(s.id, { meetUrl: localMeet || null })}

          />

        ) : (

          <span className="text-xs">{s.meetUrl ?? "—"}</span>

        )}

      </td>

      <td className="py-2">

        {canWrite && isPending && !s.id.startsWith("placeholder") && (

          <button

            type="button"

            disabled={busy}

            className="text-left text-xs text-[var(--crm-accent)] hover:underline"

            onClick={onSchedule}

          >

            Agendar

          </button>

        )}

        {canWrite && isScheduled && (

          <div className="flex flex-col gap-1">

            <button

              type="button"

              disabled={busy}

              className="text-left text-xs text-[var(--crm-accent)] hover:underline"

              onClick={onComplete}

            >

              Completar

            </button>

            <button

              type="button"

              disabled={busy}

              className="text-left text-xs text-[var(--crm-muted)] hover:underline"

              onClick={() => onNoShow(s.id)}

            >

              No-show

            </button>

          </div>

        )}

      </td>

    </tr>

  );

};



export default EnrollmentDetailClient;

