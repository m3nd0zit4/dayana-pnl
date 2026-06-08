"use client";

import type { ContactSource } from "@prisma/client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import ContactEditForm from "@/app/components/admin/crm/ContactEditForm";
import QuickMessagesPanel from "@/app/components/admin/crm/QuickMessagesPanel";
import WhatsAppContactBlock from "@/app/components/admin/crm/WhatsAppContactBlock";
import ContactNotesPanel from "@/app/components/admin/crm/ContactNotesPanel";
import RegisterPaymentModal from "@/app/components/admin/crm/RegisterPaymentModal";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { productSelectOptions } from "@/lib/crm/form-select-options";
import {
  groupProductsByKind,
  type ProductOption,
} from "@/lib/crm/product-kind-labels";
import SearchableSelect from "@/app/components/admin/crm/SearchableSelect";
import { saveContactRecent } from "@/lib/crm/contact-search-recents";

type Enrollment = {
  id: string;
  status: string;
  label: string | null;
  sessionsTotal: number | null;
  sessionsUsed: number;
  product: { id: string; title: string; kind: string };
  amountMinor: number | null;
  currency: string | null;
  payments: { id: string; status: string; amountMinor: number; currency: string; provider: string; createdAt: string }[];
};

type Contact = {
  id: string;
  phoneE164: string;
  phoneCountryIso: string | null;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  timezone: string;
  preferredLocale: string;
  countryIso: string | null;
  source: ContactSource;
  sourceDetail: string | null;
  notes: string | null;
  tiktokHandle: string | null;
  consentDataAt: Date | null;
  consentMarketingAt: Date | null;
  enrollments: Enrollment[];
};

const TABS = ["resumen", "servicios", "pagos", "notas"] as const;
type Tab = (typeof TABS)[number];

const tabBtn = (active: boolean) =>
  `rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
    active
      ? "bg-[var(--crm-accent-soft)] text-[var(--crm-accent)]"
      : "text-[var(--crm-muted)] hover:bg-black/[0.04]"
  }`;

const ServiceFlowGuide = () => (
  <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-linen)]/25 p-3 text-xs text-[var(--crm-muted)]">
    <p className="mb-2 font-medium text-[var(--crm-foreground)]">Próximos pasos</p>
    <ol className="list-decimal space-y-1 pl-4">
      <li>Crear servicio (queda en Lead si no activas)</li>
      <li>Activar cuando haya pago o acuerdo</li>
      <li>
        Terapias activas →{" "}
        <Link href="/admin/calendar" className="text-[var(--crm-accent)] hover:underline">
          Calendario
        </Link>{" "}
        o «Gestionar» en el servicio
      </li>
    </ol>
  </div>
);

const ContactDetailClient = ({
  contact: initial,
  products,
}: {
  contact: Contact;
  products: ProductOption[];
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite, toast } = useCrm();
  const [contact, setContact] = useState(initial);
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(
    initialTab === "servicios" || initialTab === "pagos" || initialTab === "notas"
      ? initialTab
      : "resumen"
  );
  const productGroups = groupProductsByKind(products);
  const flatProducts = productGroups.flatMap((g) => g.items);
  const [productId, setProductId] = useState(flatProducts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [paymentEnrollment, setPaymentEnrollment] = useState<Enrollment | null>(null);

  useEffect(() => {
    saveContactRecent({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phoneE164: contact.phoneE164,
    });
  }, [contact.id, contact.firstName, contact.lastName, contact.phoneE164]);

  const messageVars = {
    first_name: contact.firstName,
    product_title: contact.enrollments[0]?.product.title ?? "tu proceso",
  };

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "servicios" || t === "pagos" || t === "resumen" || t === "notas") setTab(t);
  }, [searchParams]);

  const addService = async () => {
    if (!productId || !canWrite) return;
    setBusy(true);
    const res = await fetch("/api/admin/enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId: contact.id, productId }),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      enrollment?: Enrollment;
    };
    if (!res.ok) {
      toast(
        data.error === "ACTIVE_THERAPY_EXISTS"
          ? "Ya hay una terapia activa para este contacto"
          : data.error === "THERAPY_MISSING_SESSIONS"
            ? "El producto de terapia no tiene sesiones configuradas"
            : "Error al crear servicio",
        "error"
      );
      return;
    }
    if (data.enrollment) {
      setContact((c) => ({
        ...c,
        enrollments: [data.enrollment!, ...c.enrollments],
      }));
      toast("Servicio creado — abre «Gestionar» en la lista o el detalle del enrollment");
    } else {
      toast("Servicio creado");
      router.refresh();
    }
  };

  const allPayments = contact.enrollments.flatMap((en) =>
    en.payments.map((p) => ({
      ...p,
      enrollmentId: en.id,
      productTitle: en.product.title,
    }))
  );

  return (
    <div className="space-y-6">
      <div className="crm-surface-card p-5">
        <h1 className="crm-section-title text-lg">
          {contact.firstName} {contact.lastName ?? ""}
        </h1>
        <div className="mt-4">
          <WhatsAppContactBlock phoneE164={contact.phoneE164} compact />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={tabBtn(tab === t)}
              onClick={() => setTab(t)}
            >
              {t === "resumen"
                ? "Resumen"
                : t === "servicios"
                  ? "Servicios"
                  : t === "notas"
                    ? "Notas"
                    : "Pagos"}
            </button>
          ))}
        </div>
      </div>

      {tab === "resumen" && (
        <>
          <ContactEditForm contact={contact} />
          <section className="crm-surface-card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="crm-font-display text-[10px] text-[var(--crm-muted)]">
                Servicios
              </h2>
              <button
                type="button"
                className="text-xs font-medium text-[var(--crm-accent)] hover:underline"
                onClick={() => setTab("servicios")}
              >
                {contact.enrollments.length > 0 ? "Ver todos →" : "Agregar servicio →"}
              </button>
            </div>
            {contact.enrollments.length === 0 ? (
              <p className="text-sm text-[var(--crm-muted)]">
                Sin servicios vinculados. Un servicio indica qué producto tiene o consultó esta
                persona (terapia, curso o taller).
              </p>
            ) : (
              <ul className="space-y-2">
                {contact.enrollments.slice(0, 4).map((en) => (
                  <li
                    key={en.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {en.product.title}{" "}
                      <span className="text-xs text-[var(--crm-muted)]">
                        · {enrollmentStatusLabel(en.status)}
                      </span>
                    </span>
                    <Link
                      href={`/admin/enrollments/${en.id}`}
                      className="shrink-0 text-xs text-[var(--crm-accent)] hover:underline"
                    >
                      Gestionar
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="crm-surface-card p-5">
            <QuickMessagesPanel vars={messageVars} />
          </section>
        </>
      )}

      {tab === "servicios" && (
        <section className="space-y-4">
          {canWrite && flatProducts.length > 0 && (
            <div className="crm-surface-card space-y-3 p-4">
              <div className="flex flex-wrap gap-2">
                <SearchableSelect
                  label="Producto"
                  hideLabel
                  value={productId}
                  options={productSelectOptions(flatProducts)}
                  onChange={setProductId}
                  className="min-w-[200px] flex-1"
                  searchPlaceholder="Buscar producto…"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void addService()}
                  className="crm-btn-secondary"
                >
                  Nuevo servicio
                </button>
              </div>
              <ServiceFlowGuide />
            </div>
          )}
          {canWrite && flatProducts.length === 0 && (
            <p className="crm-surface-card p-4 text-sm text-[var(--crm-muted)]">
              No hay productos activos.{" "}
              <Link href="/admin/products" className="text-[var(--crm-accent)] hover:underline">
                Configura el catálogo
              </Link>
              .
            </p>
          )}
          <ul className="space-y-3">
            {contact.enrollments.length === 0 && (
              <p className="text-sm text-[var(--crm-muted)]">Sin servicios aún.</p>
            )}
            {contact.enrollments.map((en) => (
              <li key={en.id} className="crm-surface-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">{en.product.title}</div>
                    <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                      {enrollmentStatusLabel(en.status)}
                      {en.sessionsTotal != null &&
                        ` · ${en.sessionsUsed}/${en.sessionsTotal} sesiones`}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {canWrite && !en.payments.some((p) => p.status === "APPROVED") && (
                      <button
                        type="button"
                        className="crm-btn-secondary text-xs"
                        onClick={() => setPaymentEnrollment(en)}
                      >
                        Registrar pago
                      </button>
                    )}
                    <Link
                      href={`/admin/enrollments/${en.id}`}
                      className="text-xs font-medium text-[var(--crm-accent)] hover:underline"
                    >
                      Gestionar →
                    </Link>
                  </div>
                </div>
                {en.product.kind === "THERAPY" && en.sessionsTotal != null && en.sessionsTotal > 0 && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                    <div
                      className="h-full rounded-full bg-[var(--crm-accent)]"
                      style={{
                        width: `${Math.min(100, (en.sessionsUsed / en.sessionsTotal) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "notas" && <ContactNotesPanel contactId={contact.id} />}

      {tab === "pagos" && (
        <section className="crm-surface-card p-5">
          <h2 className="crm-font-display mb-3 text-[10px] text-[var(--crm-muted)]">
            Historial de pagos
          </h2>
          {allPayments.length === 0 ? (
            <p className="text-sm text-[var(--crm-muted)]">Sin pagos registrados.</p>
          ) : (
            <ul className="divide-y divide-[var(--crm-border)] text-sm">
              {allPayments.map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 py-3">
                  <div>
                    <span className="font-medium">{p.productTitle}</span>
                    <div className="text-xs text-[var(--crm-muted)]">
                      {p.provider} · {p.status}
                    </div>
                  </div>
                  <div className="text-right">
                    <div>
                      {(p.amountMinor / 100).toFixed(2)} {p.currency}
                    </div>
                    <Link
                      href={`/admin/enrollments/${p.enrollmentId}`}
                      className="text-xs text-[var(--crm-accent)] hover:underline"
                    >
                      Ver servicio
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {paymentEnrollment && (
        <RegisterPaymentModal
          open={!!paymentEnrollment}
          onClose={() => setPaymentEnrollment(null)}
          enrollmentId={paymentEnrollment.id}
          productTitle={paymentEnrollment.product.title}
          contactName={`${contact.firstName} ${contact.lastName ?? ""}`.trim()}
          suggestedAmountMinor={paymentEnrollment.amountMinor}
          currency={paymentEnrollment.currency ?? "USD"}
          onSuccess={() => router.refresh()}
        />
      )}
    </div>
  );
};

export default ContactDetailClient;
