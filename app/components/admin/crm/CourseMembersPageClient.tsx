"use client";

import Link from "next/link";
import { CreditCard, Mail, CalendarClock } from "lucide-react";
import { useCallback, useState } from "react";
import type { CourseMemberRow } from "@/lib/lms/course-admin";
import CrmPageShell from "./CrmPageShell";
import CrmModal from "./CrmModal";
import CursoTabs from "./CursoTabs";
import RegisterPaymentModal from "./RegisterPaymentModal";
import { useCrm } from "./CrmProvider";

type Props = {
  preview: boolean;
  courseTitle: string;
  initialMembers: CourseMemberRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const membershipChip = (row: CourseMemberRow) => {
  if (row.status === "CANCELLED" || row.status === "REFUNDED") {
    return { label: row.status === "CANCELLED" ? "Cancelado" : "Reembolsado", cls: "bg-neutral-200 text-neutral-600" };
  }
  if (!row.paidUntil) {
    return { label: "Sin vigencia", cls: "bg-neutral-200 text-neutral-600" };
  }
  const paidUntil = new Date(row.paidUntil).getTime();
  const now = Date.now();
  if (paidUntil <= now) {
    return { label: "Vencido", cls: "bg-red-100 text-red-700" };
  }
  if (paidUntil - now <= 7 * DAY_MS) {
    return { label: "Vence pronto", cls: "bg-amber-100 text-amber-700" };
  }
  return { label: "Al día", cls: "bg-emerald-100 text-emerald-700" };
};

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", { dateStyle: "medium" })
    : "—";

const toDateInputValue = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const CourseMembersPageClient = ({
  preview,
  courseTitle,
  initialMembers,
}: Props) => {
  const { canWrite, toast } = useCrm();
  const [rows, setRows] = useState<CourseMemberRow[]>(initialMembers);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<CourseMemberRow | null>(
    null
  );
  const [adjustTarget, setAdjustTarget] = useState<CourseMemberRow | null>(
    null
  );
  const [adjustDate, setAdjustDate] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);

  const reload = useCallback(async () => {
    if (preview) return;
    const res = await fetch("/api/admin/lms/members");
    if (!res.ok) return;
    const data = (await res.json()) as { members?: CourseMemberRow[] };
    if (data.members) setRows(data.members);
  }, [preview]);

  const invite = async (row: CourseMemberRow) => {
    setInvitingId(row.contact.id);
    const res = await fetch(
      `/api/admin/lms/members/${row.contact.id}/invite`,
      { method: "POST" }
    );
    setInvitingId(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      toast(
        data?.error === "no_email"
          ? "El contacto no tiene email registrado"
          : "No se pudo enviar la invitación",
        "error"
      );
      return;
    }
    toast("Invitación enviada");
  };

  const saveAdjust = async () => {
    if (!adjustTarget) return;
    setAdjustSaving(true);
    const paidUntil = adjustDate
      ? new Date(`${adjustDate}T23:59:00`).toISOString()
      : null;
    const res = await fetch(
      `/api/admin/lms/members/${adjustTarget.enrollmentId}/paid-until`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paidUntil }),
      }
    );
    setAdjustSaving(false);
    if (!res.ok) {
      toast("No se pudo ajustar la vigencia", "error");
      return;
    }
    toast("Vigencia actualizada");
    setAdjustTarget(null);
    void reload();
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="crm-section-title text-xl">Curso · Miembros</h1>
            <p className="crm-section-subtitle mt-1">
              Membresías mensuales de «{courseTitle}». Cada pago aprobado suma
              un mes de acceso al portal.
            </p>
          </div>
          <CursoTabs />
        </div>

        <div className="crm-surface-card overflow-hidden">
          <ul className="divide-y divide-[var(--crm-border)]">
            {rows.length === 0 && (
              <li className="p-8 text-center text-sm text-[var(--crm-muted)]">
                Sin miembros todavía. Se crean al pagar el curso o al vincular
                el producto desde un contacto.
              </li>
            )}
            {rows.map((row) => {
              const chip = membershipChip(row);
              return (
                <li key={row.enrollmentId} className="crm-table-row p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link
                        href={preview ? "#" : `/admin/contacts/${row.contact.id}`}
                        className="text-sm font-semibold text-[var(--crm-foreground)] hover:underline"
                      >
                        {row.contact.firstName} {row.contact.lastName ?? ""}
                      </Link>
                      <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                        {row.contact.email ?? "Sin email"} ·{" "}
                        {row.contact.phoneE164}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--crm-muted)]">
                        <span>
                          Último pago: {formatDate(row.lastPaymentAt)} (
                          {row.paymentsCount})
                        </span>
                        <span>
                          Cuenta portal:{" "}
                          {row.hasAccount ? "activa" : "sin crear"}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${chip.cls}`}
                      >
                        {chip.label}
                      </span>
                      <div className="mt-1 text-xs text-[var(--crm-muted)]">
                        Vigente hasta: {formatDate(row.paidUntil)}
                      </div>

                      {!preview && canWrite && (
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            className="crm-btn-secondary inline-flex items-center gap-1.5 text-xs"
                            disabled={
                              invitingId === row.contact.id ||
                              !row.contact.email
                            }
                            onClick={() => invite(row)}
                            title={
                              row.contact.email
                                ? undefined
                                : "El contacto no tiene email"
                            }
                          >
                            <Mail className="size-3.5" aria-hidden />
                            {invitingId === row.contact.id
                              ? "Enviando…"
                              : row.hasAccount
                                ? "Reenviar acceso"
                                : "Invitar"}
                          </button>
                          <button
                            type="button"
                            className="crm-btn-secondary inline-flex items-center gap-1.5 text-xs"
                            onClick={() => setPaymentTarget(row)}
                          >
                            <CreditCard className="size-3.5" aria-hidden />
                            Registrar pago
                          </button>
                          <button
                            type="button"
                            className="crm-btn-ghost inline-flex items-center gap-1.5 text-xs"
                            onClick={() => {
                              setAdjustTarget(row);
                              setAdjustDate(toDateInputValue(row.paidUntil));
                            }}
                          >
                            <CalendarClock className="size-3.5" aria-hidden />
                            Ajustar vigencia
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {paymentTarget && (
        <RegisterPaymentModal
          open={!!paymentTarget}
          onClose={() => setPaymentTarget(null)}
          enrollmentId={paymentTarget.enrollmentId}
          productTitle={courseTitle}
          contactName={`${paymentTarget.contact.firstName} ${paymentTarget.contact.lastName ?? ""}`.trim()}
          suggestedAmountMinor={paymentTarget.amountMinor}
          currency={paymentTarget.currency ?? "USD"}
          onSuccess={() => void reload()}
        />
      )}

      <CrmModal
        title="Ajustar vigencia"
        open={!!adjustTarget}
        onClose={() => setAdjustTarget(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--crm-muted)]">
            Fija hasta cuándo tiene acceso{" "}
            <strong>
              {adjustTarget?.contact.firstName}{" "}
              {adjustTarget?.contact.lastName ?? ""}
            </strong>
            . Deja el campo vacío para quitar la vigencia.
          </p>
          <label className="block">
            <span className="crm-label">Vigente hasta</span>
            <input
              type="date"
              className="crm-input"
              value={adjustDate}
              onChange={(e) => setAdjustDate(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="crm-btn-secondary"
              onClick={() => setAdjustTarget(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="crm-btn-primary"
              disabled={adjustSaving}
              onClick={() => void saveAdjust()}
            >
              {adjustSaving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </CrmModal>
    </CrmPageShell>
  );
};

export default CourseMembersPageClient;
