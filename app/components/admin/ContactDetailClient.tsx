"use client";

import type { ContactSource } from "@prisma/client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import ContactEditForm from "@/app/components/admin/crm/ContactEditForm";
import DeleteContactDialog from "@/app/components/admin/crm/DeleteContactDialog";
import QuickMessagesPanel from "@/app/components/admin/crm/QuickMessagesPanel";
import WhatsAppContactBlock from "@/app/components/admin/crm/WhatsAppContactBlock";
import ContactNotesPanel from "@/app/components/admin/crm/ContactNotesPanel";
import CrmSegmentedControl from "@/app/components/admin/crm/CrmSegmentedControl";
import RegisterPaymentModal from "@/app/components/admin/crm/RegisterPaymentModal";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { stripEphemeralNotebookParams } from "@/lib/crm/contact-notebook-url";
import { productSelectOptions } from "@/lib/crm/form-select-options";
import {
  groupProductsByKind,
  type ProductOption,
} from "@/lib/crm/product-kind-labels";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
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

const TABS = [
  { id: "resumen" as const, label: "Resumen" },
  { id: "servicios" as const, label: "Servicios" },
  { id: "pagos" as const, label: "Pagos" },
  { id: "notas" as const, label: "Cuaderno" },
];
type Tab = (typeof TABS)[number]["id"];

const ContactDetailClient = ({
  contact: initial,
  products,
}: {
  contact: Contact;
  products: ProductOption[];
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite, toast, focusMode, setFocusMode } = useCrm();
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const focusFromUrl = searchParams.get("focus") === "1";
  const [notebookOpen, setNotebookOpen] = useState(
    () => focusFromUrl && searchParams.get("tab") === "notas"
  );

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

  useLayoutEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!stripEphemeralNotebookParams(params)) return;
    const qs = params.toString();
    router.replace(`/admin/contacts/${contact.id}${qs ? `?${qs}` : ""}`, {
      scroll: false,
    });
  }, [contact.id, router, searchParams]);

  useLayoutEffect(() => {
    const t = searchParams.get("tab");
    if (t === "servicios" || t === "pagos" || t === "resumen" || t === "notas") setTab(t);
    const focus = searchParams.get("focus") === "1";
    setFocusMode(focus);
    if (focus && t === "notas") setNotebookOpen(true);
  }, [searchParams, setFocusMode]);

  const exitFocusMode = useCallback(() => {
    setFocusMode(false);
    setNotebookOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("focus");
    const qs = params.toString();
    router.replace(`/admin/contacts/${contact.id}${qs ? `?${qs}` : ""}`, {
      scroll: false,
    });
  }, [contact.id, router, searchParams, setFocusMode]);

  const openNotebook = useCallback(() => {
    setNotebookOpen(true);
    setFocusMode(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "notas");
    params.set("focus", "1");
    router.replace(`/admin/contacts/${contact.id}?${params.toString()}`, {
      scroll: false,
    });
  }, [contact.id, router, searchParams, setFocusMode]);

  const preloadNotebook = useCallback(() => {
    void import("@excalidraw/excalidraw");
  }, []);

  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFocusMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, exitFocusMode]);

  const goToTab = (next: Tab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "resumen") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.replace(`/admin/contacts/${contact.id}${qs ? `?${qs}` : ""}`, {
      scroll: false,
    });
    if (next === "notas") {
      requestAnimationFrame(() => {
        document
          .getElementById("cuaderno-clinico")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

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

  const deleteContact = async (phoneConfirm: string) => {
    setDeleteBusy(true);
    setDeleteError(null);
    const res = await fetch(`/api/admin/contacts/${contact.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneConfirm }),
    });
    setDeleteBusy(false);
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setDeleteError(
        data.error === "phone_mismatch"
          ? "El teléfono no coincide. Escribe exactamente el número mostrado."
          : "No se pudo eliminar el contacto"
      );
      return;
    }
    toast("Contacto eliminado");
    setDeleteOpen(false);
    router.push("/admin/contacts");
    router.refresh();
  };

  const allPayments = contact.enrollments.flatMap((en) =>
    en.payments.map((p) => ({
      ...p,
      enrollmentId: en.id,
      productTitle: en.product.title,
    }))
  );

  const isFocusNotebook = focusFromUrl && tab === "notas";

  const notebookProps = {
    contactId: contact.id,
    contactName: `${contact.firstName} ${contact.lastName ?? ""}`.trim(),
  };

  return (
    <div className={isFocusNotebook ? "crm-focus-workspace" : "space-y-4"}>
      {!isFocusNotebook && (
        <div className="space-y-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {contact.firstName} {contact.lastName ?? ""}
          </h1>
          <WhatsAppContactBlock phoneE164={contact.phoneE164} compact />
          <CrmSegmentedControl
            value={tab}
            onChange={goToTab}
            segments={TABS}
            aria-label="Secciones del contacto"
          />
        </div>
      )}

      {!isFocusNotebook && tab === "resumen" && (
        <>
          <ContactEditForm contact={contact} />
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Servicios</h2>
              <Button variant="ghost" size="sm" onClick={() => goToTab("servicios")}>
                {contact.enrollments.length > 0 ? "Ver todos" : "Agregar"}
              </Button>
            </div>
            <Card className="overflow-hidden py-0">
              <CardContent className="divide-y divide-border p-0">
                {contact.enrollments.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-muted-foreground">Sin servicios</p>
                ) : (
                  contact.enrollments.slice(0, 5).map((en) => (
                    <Link
                      key={en.id}
                      href={`/admin/enrollments/${en.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{en.product.title}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {enrollmentStatusLabel(en.status)}
                        </span>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
          <Card>
            <CardContent>
              <QuickMessagesPanel vars={messageVars} />
            </CardContent>
          </Card>
          {canWrite && (
            <Card className="border-destructive/30">
              <CardContent>
                <h2 className="text-sm font-semibold text-destructive">Zona de riesgo</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Elimina este contacto y todos sus datos del CRM.
                </p>
                <Button
                  variant="destructive"
                  className="mt-3"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteOpen(true);
                  }}
                >
                  Eliminar contacto…
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!isFocusNotebook && tab === "servicios" && (
        <section className="space-y-4">
          {canWrite && flatProducts.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <SearchableSelect
                label="Producto"
                hideLabel
                value={productId}
                options={productSelectOptions(flatProducts)}
                onChange={setProductId}
                className="min-w-0 flex-1 sm:min-w-[200px]"
                searchPlaceholder="Buscar producto…"
              />
              <Button disabled={busy} size="sm" onClick={() => void addService()}>
                Nuevo servicio
              </Button>
            </div>
          )}
          {canWrite && flatProducts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay productos activos.{" "}
              <Link href="/admin/products" className="text-primary">
                Configura el catálogo
              </Link>
              .
            </p>
          )}
          <Card className="overflow-hidden py-0">
            <CardContent className="divide-y divide-border p-0">
              {contact.enrollments.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">Sin servicios</p>
              ) : (
                contact.enrollments.map((en) => (
                  <div key={en.id} className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{en.product.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {enrollmentStatusLabel(en.status)}
                        {en.sessionsTotal != null &&
                          ` · ${en.sessionsUsed}/${en.sessionsTotal} sesiones`}
                      </div>
                      {en.product.kind === "THERAPY" &&
                        en.sessionsTotal != null &&
                        en.sessionsTotal > 0 && (
                          <div className="mt-2 h-1.5 max-w-[10rem] overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{
                                width: `${Math.min(100, (en.sessionsUsed / en.sessionsTotal) * 100)}%`,
                              }}
                            />
                          </div>
                        )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {canWrite && !en.payments.some((p) => p.status === "APPROVED") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPaymentEnrollment(en)}
                        >
                          Pago
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/admin/enrollments/${en.id}`} />}>
                        Gestionar
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {(tab === "notas" || isFocusNotebook) && (
        <div
          className={
            isFocusNotebook
              ? "crm-focus-workspace flex min-h-0 flex-1 flex-col"
              : undefined
          }
        >
          <ContactNotesPanel
            {...notebookProps}
            focusMode={isFocusNotebook}
            notebookOpen={notebookOpen}
            onOpenNotebook={openNotebook}
            onPreloadNotebook={preloadNotebook}
            onExitFocus={isFocusNotebook ? exitFocusMode : undefined}
          />
        </div>
      )}

      {!isFocusNotebook && tab === "pagos" && (
        <section>
          <Card className="overflow-hidden py-0">
            <CardContent className="divide-y divide-border p-0">
              {allPayments.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">Sin pagos</p>
              ) : (
                allPayments.map((p) => (
                  <Link
                    key={p.id}
                    href={`/admin/enrollments/${p.enrollmentId}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.productTitle}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.provider} · {p.status}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm tabular-nums">
                      {(p.amountMinor / 100).toFixed(2)} {p.currency}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
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

      <DeleteContactDialog
        open={deleteOpen}
        contactName={`${contact.firstName} ${contact.lastName ?? ""}`.trim()}
        phoneE164={contact.phoneE164}
        busy={deleteBusy}
        error={deleteError}
        onClose={() => {
          if (!deleteBusy) setDeleteOpen(false);
        }}
        onConfirm={deleteContact}
      />
    </div>
  );
};

export default ContactDetailClient;
