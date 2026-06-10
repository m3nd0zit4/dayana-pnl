"use client";

import Link from "next/link";
import { EnrollmentStatus } from "@prisma/client";
import { CreditCard, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { enrollmentStatusSelectOptions } from "@/lib/crm/form-select-options";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import EnrollmentFormModal from "./EnrollmentFormModal";
import RegisterPaymentModal from "./RegisterPaymentModal";
import { useCrm } from "./CrmProvider";

type Enrollment = {
  id: string;
  status: EnrollmentStatus;
  label: string | null;
  sessionsUsed: number;
  sessionsTotal: number | null;
  contact: { id: string; firstName: string; lastName: string | null; phoneE164: string };
  product: { title: string; kind: string };
  workshopEdition: { title: string } | null;
  amountMinor: number | null;
  currency: string | null;
  payments: { id: string }[];
};

type Props = {
  preview: boolean;
  initialRows?: Enrollment[];
  initialStatus?: string;
  initialQ?: string;
};

const ServicesPageClient = ({
  preview,
  initialRows = [],
  initialStatus = "all",
  initialQ = "",
}: Props) => {
  const { canWrite, toast, confirm } = useCrm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Enrollment[]>(initialRows);
  const [status, setStatus] = useState(searchParams.get("status") ?? initialStatus);
  const [q, setQ] = useState(searchParams.get("q") ?? initialQ);
  const [modalOpen, setModalOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(!preview && initialRows.length === 0);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (preview) {
      setRows([
        {
          id: "prev-e1",
          status: EnrollmentStatus.ACTIVE,
          label: null,
          sessionsUsed: 2,
          sessionsTotal: 6,
          contact: {
            id: "preview-1",
            firstName: "María",
            lastName: "González",
            phoneE164: "+34612345678",
          },
          product: { title: "Terapia 6 sesiones", kind: "THERAPY" },
          workshopEdition: null,
          amountMinor: 8000,
          currency: "USD",
          payments: [],
        },
      ]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/admin/enrollments?${params}`)
      .then((r) => r.json())
      .then((enData) => setRows(enData.enrollments ?? []))
      .finally(() => setLoading(false));
  }, [preview, status, q]);

  useEffect(() => {
    const urlStatus = searchParams.get("status") ?? "all";
    const urlQ = searchParams.get("q") ?? "";
    setStatus(urlStatus);
    setQ(urlQ);
    if (preview) {
      load();
      return;
    }
    if (urlStatus !== initialStatus || urlQ !== initialQ) {
      load();
    }
  }, [searchParams, preview, load, initialStatus, initialQ]);

  const updateStatus = async (id: string, next: EnrollmentStatus) => {
    const prev = rows.find((r) => r.id === id);
    if (!prev || prev.status === next) return;

    setStatusSavingId(id);
    setRows((list) =>
      list.map((r) => (r.id === id ? { ...r, status: next } : r))
    );

    const res = await fetch(`/api/admin/enrollments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const data = (await res.json()) as { error?: string; enrollment?: Enrollment };
    setStatusSavingId(null);

    if (!res.ok) {
      setRows((list) =>
        list.map((r) => (r.id === id ? { ...r, status: prev.status } : r))
      );
      toast(
        data.error === "ACTIVE_THERAPY_EXISTS"
          ? "Ya hay otra terapia activa para este contacto"
          : "No se pudo actualizar",
        "error"
      );
      return;
    }

    if (data.enrollment) {
      setRows((list) =>
        list.map((r) =>
          r.id === id ? { ...r, status: data.enrollment!.status } : r
        )
      );
    }
    toast(`Estado cambiado a «${enrollmentStatusLabel(next)}»`);
  };

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (status !== "all") p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    router.push(`/admin/services?${p}`);
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="crm-section-title text-xl">Servicios</h1>
            <p className="crm-section-subtitle mt-1">
              Vincula un producto del catálogo a un contacto. También puedes hacerlo al crear
              el contacto o desde su ficha en Contactos.
            </p>
          </div>
          {!preview && (
            <button
              type="button"
              className="crm-btn-primary"
              onClick={() => setModalOpen(true)}
            >
              <Plus className="size-4" />
              Nuevo servicio
            </button>
          )}
        </div>

        <form
          onSubmit={applyFilters}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="min-w-[160px]">
            <SearchableSelect
              id="f-status"
              label="Estado"
              value={status}
              options={enrollmentStatusSelectOptions(true)}
              onChange={setStatus}
              panelMinWidth={200}
              searchMinOptions={99}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="crm-label" htmlFor="f-q">
              Buscar
            </label>
            <input
              id="f-q"
              className="crm-input"
              placeholder="Nombre, teléfono o producto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button type="submit" className="crm-btn-secondary">
            Filtrar
          </button>
        </form>

        <div className="crm-surface-card overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-[var(--crm-muted)]">Cargando…</p>
          ) : (
            <ul className="divide-y divide-[var(--crm-border)]">
              {rows.length === 0 && (
                <li className="p-8 text-center text-sm text-[var(--crm-muted)]">
                  Sin servicios. Crea uno desde un contacto o con el botón de arriba.
                </li>
              )}
              {rows.map((en) => (
                <li key={en.id} className="crm-table-row p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{en.product.title}</div>
                      <Link
                        href={preview ? "#" : `/admin/contacts/${en.contact.id}`}
                        className="mt-0.5 text-xs text-[var(--crm-accent)] hover:underline"
                      >
                        {en.contact.firstName} {en.contact.lastName ?? ""} ·{" "}
                        {en.contact.phoneE164}
                      </Link>
                      {en.workshopEdition && (
                        <div className="mt-1 text-xs text-[var(--crm-muted)]">
                          {en.workshopEdition.title}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      {canWrite && !preview ? (
                        <SearchableSelect
                          label="Estado"
                          hideLabel
                          value={en.status}
                          options={enrollmentStatusSelectOptions()}
                          onChange={(next) => {
                            const status = next as EnrollmentStatus;
                            if (status === en.status) return;
                            if (status === EnrollmentStatus.CANCELLED) {
                              confirm({
                                title: "Cancelar servicio",
                                message: "¿Marcar este enrollment como cancelado?",
                                onConfirm: () => updateStatus(en.id, status),
                              });
                            } else {
                              void updateStatus(en.id, status);
                            }
                          }}
                          disabled={statusSavingId === en.id}
                          className="w-auto"
                          menuVariant="status"
                          panelMinWidth={200}
                          searchMinOptions={99}
                        />
                      ) : (
                        <span className="rounded-full bg-[var(--crm-linen)]/60 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--crm-accent)]">
                          {enrollmentStatusLabel(en.status)}
                        </span>
                      )}
                      {en.sessionsTotal != null && (
                        <div className="mt-1 text-xs text-[var(--crm-muted)]">
                          {en.sessionsUsed}/{en.sessionsTotal} sesiones
                        </div>
                      )}
                      {!preview && (
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                          {canWrite && en.payments.length === 0 && (
                            <button
                              type="button"
                              className="crm-btn-secondary inline-flex items-center gap-1.5 text-xs"
                              onClick={() => setPaymentTarget(en)}
                            >
                              <CreditCard className="size-3.5" aria-hidden />
                              Registrar pago
                            </button>
                          )}
                          <Link
                            href={`/admin/enrollments/${en.id}`}
                            className="crm-btn-ghost text-xs"
                          >
                            Gestionar →
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <EnrollmentFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => load()}
      />

      {paymentTarget && (
        <RegisterPaymentModal
          open={!!paymentTarget}
          onClose={() => setPaymentTarget(null)}
          enrollmentId={paymentTarget.id}
          productTitle={paymentTarget.product.title}
          contactName={`${paymentTarget.contact.firstName} ${paymentTarget.contact.lastName ?? ""}`.trim()}
          suggestedAmountMinor={paymentTarget.amountMinor}
          currency={paymentTarget.currency ?? "USD"}
          onSuccess={() => load()}
        />
      )}
    </CrmPageShell>
  );
};

export default ServicesPageClient;
