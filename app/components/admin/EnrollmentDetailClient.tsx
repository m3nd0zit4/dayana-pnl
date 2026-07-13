"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import { EnrollmentStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { BookOpen } from "lucide-react";
import RegisterPaymentModal, {
  type RegisteredPayment,
} from "@/app/components/admin/crm/RegisterPaymentModal";
import ScheduleSessionModal from "@/app/components/admin/crm/ScheduleSessionModal";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import SearchableSelect from "@/app/components/admin/crm/SearchableSelect";
import { enrollmentStatusSelectOptions } from "@/lib/crm/form-select-options";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { contactNotebookPath } from "@/lib/crm/contact-notebook-url";
import { formatSessionDateTimeEs } from "@/lib/crm/datetime-local";
import { formatMoneyMinor } from "@/lib/crm/money";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";

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

const sectionHeading = "mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const SCHEDULABLE_STATUSES = new Set([
  "PENDING_SCHEDULE",
  "SCHEDULED",
  "RESCHEDULED",
  "CANCELLED",
]);

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
  const router = useRouter();
  const [enrollment, setEnrollment] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [scheduleSession, setScheduleSession] = useState<Session | null>(null);
  const pkg = enrollment.therapyPackage;

  const refreshPackage = useCallback(async () => {
    const res = await fetch(
      `/api/admin/therapy/sessions?enrollmentId=${enrollment.id}`
    );

    const data = (await res.json()) as {
      therapyPackage?: (NonNullable<typeof initial.therapyPackage> & {
        enrollment?: { status: string; sessionsUsed: number };
      }) | null;
    };

    if (data.therapyPackage) {
      const pkg = data.therapyPackage;
      setEnrollment((e) => ({
        ...e,
        status: pkg.enrollment?.status ?? e.status,
        sessionsUsed: pkg.enrollment?.sessionsUsed ?? pkg.usedSessions ?? e.sessionsUsed,
        therapyPackage: {
          ...pkg,
          sessions: pkg.sessions.map((s) => ({
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
                  label: "Abrir cuaderno clínico",
                  href: contactNotebookPath(enrollment.contact.id, {
                    focus: true,
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

  const uncompleteSession = (sessionId: string, sessionNumber: number) => {
    if (!pkg || sessionId.startsWith("placeholder")) return;

    confirm({
      title: `Deshacer sesión ${sessionNumber}`,
      message:
        "¿Quitar el completado de esta sesión? Se restará del contador y el servicio volverá a activo si estaba marcado como completado.",
      onConfirm: async () => {
        setBusy(true);
        const res = await fetch("/api/admin/therapy/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "uncomplete",
            sessionId,
            therapyPackageId: pkg.id,
            sessionNumber,
          }),
        });
        setBusy(false);

        const data = (await res.json()) as { error?: string };
        if (res.ok) {
          toast("Sesión desmarcada como completada");
          void refreshPackage();
        } else if (data.error === "ACTIVE_THERAPY_EXISTS") {
          toast("Este contacto ya tiene otra terapia activa", "error");
        } else {
          toast("No se pudo deshacer el completado", "error");
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

  const deleteService = () => {
    confirm({
      title: "Eliminar servicio",
      message: `¿Eliminar «${enrollment.product.title}» de ${enrollment.contact.firstName}? No tiene pagos registrados — esta acción no se puede deshacer.`,
      onConfirm: async () => {
        setDeleting(true);
        const res = await fetch(`/api/admin/enrollments/${enrollment.id}`, {
          method: "DELETE",
        });
        setDeleting(false);

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast(
            data.error === "HAS_APPROVED_PAYMENT"
              ? "Este servicio ya tiene un pago registrado — no se puede eliminar"
              : "No se pudo eliminar el servicio",
            "error"
          );
          return;
        }

        toast("Servicio eliminado");
        router.push(`/admin/contacts/${enrollment.contact.id}`);
        router.refresh();
      },
    });
  };
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
        <p className="mt-2 text-sm text-muted-foreground">
          <Link
            href={`/admin/contacts/${enrollment.contact.id}`}
            className="text-primary hover:underline"
          >
            {enrollment.contact.firstName}
          </Link>{" "}
          · {displayContactPhone(enrollment.contact.phoneE164) ?? "Sin teléfono"}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">Estado</span>
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
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={contactNotebookPath(enrollment.contact.id, { focus: true })} />}
            >
              <BookOpen aria-hidden />
              Cuaderno
            </Button>
          )}

          {enrollment.sessionsTotal != null && (
            <span className="text-xs text-muted-foreground">
              Sesiones {enrollment.sessionsUsed}/{enrollment.sessionsTotal}
            </span>
          )}
        </div>
        <div className="mt-3 h-2 max-w-md overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      </div>

      {canWrite && (
        <Card>
          <CardContent>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className={sectionHeading}>Pago del servicio</h2>
                {hasApprovedPayment ? (
                  <p className="text-sm text-muted-foreground">
                    {enrollment.payments.length} pago(s) registrado(s)
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sin pago aún
                    {enrollment.amountMinor
                      ? ` · precio referencia $${formatMoneyMinor(enrollment.amountMinor, enrollment.currency ?? "USD")} ${enrollment.currency ?? "USD"}`
                      : ""}
                  </p>
                )}
              </div>
              <Button size="sm" disabled={busy} onClick={() => setPaymentOpen(true)}>
                {hasApprovedPayment ? "Registrar otro pago" : "Registrar pago"}
              </Button>
            </div>

            {needsPayment && (
              <p className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-primary">
                Tip: al registrar el pago el servicio se activa solo — no hace falta cambiar el estado a mano.
              </p>
            )}

            {enrollment.payments.length > 0 && (
              <ul className="mt-4 divide-y divide-border text-sm">
                {enrollment.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 py-2.5 first:pt-0">
                    <span className="text-muted-foreground">
                      {p.provider} · {p.status}
                    </span>
                    <span className="font-medium">
                      {formatMoneyMinor(p.amountMinor, p.currency)} {p.currency}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {!hasApprovedPayment && (
              <div className="mt-4 border-t border-border pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={deleting}
                  onClick={deleteService}
                >
                  {deleting ? "Eliminando…" : "Eliminar servicio"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {pkg && (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={sectionHeading}>Sesiones</h2>
              <p className="text-xs text-muted-foreground">Agenda en Google Calendar</p>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allSessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      timezone={enrollment.contact.timezone}
                      canWrite={canWrite}
                      busy={busy}
                      onComplete={() => completeSession(s.id, s.sessionNumber)}
                      onUncomplete={() => uncompleteSession(s.id, s.sessionNumber)}
                      onSchedule={() => setScheduleSession(s)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {pkg && scheduleSession && (
        <ScheduleSessionModal
          open={scheduleSession != null}
          onClose={() => setScheduleSession(null)}
          onScheduled={() => {
            setScheduleSession(null);
            void refreshPackage();
          }}
          therapyPackageId={pkg.id}
          sessionNumber={scheduleSession.sessionNumber}
          meetDefaultUrl={pkg.meetDefaultUrl}
          contactTimezone={enrollment.contact.timezone}
          contactName={enrollment.contact.firstName}
          productTitle={enrollment.product.title}
          initialScheduledAt={scheduleSession.scheduledAt ?? undefined}
        />
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
  timezone,
  canWrite,
  busy,
  onComplete,
  onUncomplete,
  onSchedule,
}: {
  session: Session;
  timezone: string;
  canWrite: boolean;
  busy: boolean;
  onComplete: () => void;
  onUncomplete: () => void;
  onSchedule: () => void;
}) => {
  const isCompleted = s.status === "COMPLETED";
  const isPlaceholder = s.id.startsWith("placeholder");
  const canComplete = canWrite && !isCompleted && !isPlaceholder;
  const canUncomplete = canWrite && isCompleted && !isPlaceholder;
  const canSchedule =
    canWrite &&
    !isPlaceholder &&
    !isCompleted &&
    SCHEDULABLE_STATUSES.has(s.status);

  return (
    <TableRow>
      <TableCell className="font-medium">{s.sessionNumber}</TableCell>
      <TableCell className="text-xs">{sessionStatusLabel(s.status)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {s.scheduledAt ? formatSessionDateTimeEs(s.scheduledAt, timezone) : "—"}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          {canSchedule && (
            <Button variant="outline" size="sm" disabled={busy} onClick={onSchedule}>
              {s.scheduledAt ? "Cambiar fecha" : "Agregar fecha"}
            </Button>
          )}
          {canComplete && (
            <Button size="sm" disabled={busy} onClick={onComplete}>
              Completar
            </Button>
          )}
          {canUncomplete && (
            <Button variant="outline" size="sm" disabled={busy} onClick={onUncomplete}>
              Quitar completado
            </Button>
          )}
          {isCompleted && !canUncomplete && (
            <span className="text-xs text-muted-foreground">Completada</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

export default EnrollmentDetailClient;
