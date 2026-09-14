"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import { EnrollmentStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import RegisterPaymentModal, {
  type RegisteredPayment,
} from "@/app/components/admin/crm/RegisterPaymentModal";
import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import SearchableSelect from "@/app/components/admin/crm/SearchableSelect";
import { enrollmentStatusSelectOptions } from "@/lib/crm/form-select-options";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { formatMoneyMinor } from "@/lib/crm/money";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

const sectionHeading = "mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

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
    payments: {
      id: string;
      status: string;
      amountMinor: number;
      currency: string;
      provider: string;
    }[];
  };
}) => {
  const { canWrite, canRecordPayments, toast, confirm } = useCrm();
  const router = useRouter();
  const [enrollment, setEnrollment] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

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

  const progress = enrollment.sessionsTotal
    ? (enrollment.sessionsUsed / enrollment.sessionsTotal) * 100
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <CrmPageHeader
          title={enrollment.product.title}
          backHref={`/admin/contacts/${enrollment.contact.id}`}
          backLabel={enrollment.contact.firstName}
          description={
            <>
              <Link
                href={`/admin/contacts/${enrollment.contact.id}`}
                className="text-primary hover:underline"
              >
                {enrollment.contact.firstName}
              </Link>{" "}
              · {displayContactPhone(enrollment.contact.phoneE164) ?? "Sin teléfono"}
            </>
          }
        />
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
              {/* Sólo OWNER y OPERATOR: la API de pagos manuales rechaza al resto. */}
              {canRecordPayments ? (
                <Button size="sm" disabled={deleting} onClick={() => setPaymentOpen(true)}>
                  {hasApprovedPayment ? "Registrar otro pago" : "Registrar pago"}
                </Button>
              ) : null}
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

export default EnrollmentDetailClient;
