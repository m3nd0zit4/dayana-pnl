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
import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmSegmentedControl from "@/app/components/admin/crm/CrmSegmentedControl";
import RegisterPaymentModal from "@/app/components/admin/crm/RegisterPaymentModal";
import AddEnrollmentModal from "@/app/components/admin/crm/AddEnrollmentModal";
import CrmModal from "@/app/components/admin/crm/CrmModal";
import SearchableSelect from "@/app/components/admin/crm/SearchableSelect";
import { formatMoneyMinor } from "@/lib/crm/money";
import { contactDeleteConfirmationTarget } from "@/lib/crm/contact-phone";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { stripEphemeralNotebookParams } from "@/lib/crm/contact-notebook-url";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
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
  tags?: { tag: { id: string; slug: string; label: string } }[];
  enrollments: Enrollment[];
  /**
   * El webinar gratuito se lista en Servicios sin ser un Enrollment: es
   * gratuito, no pasa por checkout, y a escala de 10k registradas inflaría los
   * contadores del dashboard. Aquí solo se muestra.
   */
  webinarRegistrations?: WebinarRegistrationRow[];
};

export type WebinarRegistrationRow = {
  id: string;
  createdAt: Date | string;
  linkEmailSentAt: Date | string | null;
  reminder24hSentAt: Date | string | null;
  reminder1hSentAt: Date | string | null;
  webinar: {
    slug: string;
    startsAt: Date | string | null;
    startsAtHasTime: boolean;
    meetUrl: string | null;
  };
};

const shortDate = (v: Date | string): string =>
  new Date(v).toLocaleDateString("es-CO", { day: "numeric", month: "short" });

/** Resume en una línea qué correos del webinar ya le llegaron a esta persona. */
const webinarSendSummary = (r: WebinarRegistrationRow): string => {
  const done: string[] = [];
  if (r.linkEmailSentAt) done.push("enlace");
  if (r.reminder24hSentAt) done.push("24 h");
  if (r.reminder1hSentAt) done.push("1 h");
  return done.length ? `Enviado: ${done.join(", ")}` : "Sin correos aún";
};

const WebinarServiceRow = ({ r }: { r: WebinarRegistrationRow }) => (
  <Link
    href="/admin/webinar"
    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
  >
    <div className="min-w-0 flex-1">
      <span className="font-medium">Webinar gratuito</span>
      <span className="ml-2 text-xs text-muted-foreground">
        Registrada {shortDate(r.createdAt)} · {webinarSendSummary(r)}
      </span>
    </div>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  </Link>
);

const TABS = [
  { id: "resumen" as const, label: "Resumen" },
  { id: "servicios" as const, label: "Servicios" },
  { id: "pagos" as const, label: "Pagos" },
  { id: "notas" as const, label: "Cuaderno" },
];
type Tab = (typeof TABS)[number]["id"];

const ContactDetailClient = ({ contact: initial }: { contact: Contact }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite, toast, focusMode, setFocusMode } = useCrm();
  // Sin ediciones locales del contacto: usar el prop directo hace que
  // router.refresh() traiga siempre el estado fresco del servidor.
  const contact = initial;
  const webinarRegistrations = contact.webinarRegistrations ?? [];
  const serviceCount = contact.enrollments.length + webinarRegistrations.length;
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(
    initialTab === "servicios" || initialTab === "pagos" || initialTab === "notas"
      ? initialTab
      : "resumen"
  );
  const [paymentEnrollment, setPaymentEnrollment] = useState<Enrollment | null>(null);
  const [addEnrollmentOpen, setAddEnrollmentOpen] = useState(false);
  const [pickEnrollmentOpen, setPickEnrollmentOpen] = useState(false);
  const [pickedEnrollmentId, setPickedEnrollmentId] = useState("");
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

  // focusMode lives in CrmProvider (shared across the whole /admin layout),
  // so it hides the sidebar/navbar app-wide, not just on this page. The only
  // other place that clears it is exitFocusMode() (the notebook's own close
  // button) — if this page is left any other way (browser back, sign out,
  // a direct link) while in focus mode, the app is stranded without a
  // sidebar on whatever page comes next. Reset it defensively on unmount.
  useEffect(() => {
    return () => setFocusMode(false);
  }, [setFocusMode]);

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

  const deleteConfirmTarget = contactDeleteConfirmationTarget(contact);

  const deleteContact = async (confirm: string) => {
    setDeleteBusy(true);
    setDeleteError(null);
    const res = await fetch(`/api/admin/contacts/${contact.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
    setDeleteBusy(false);
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      if (data.error === "confirmation_mismatch") {
        setDeleteError(
          deleteConfirmTarget.kind === "phone"
            ? "El teléfono no coincide. Escribe exactamente el número mostrado."
            : "El nombre no coincide. Escribe exactamente el nombre mostrado."
        );
      } else if (data.error === "placeholder") {
        setDeleteError(
          "Este contacto es un checkout abandonado y se limpia solo — no se puede borrar manualmente."
        );
      } else {
        setDeleteError("No se pudo eliminar el contacto");
      }
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

  const startRegisterPayment = () => {
    if (contact.enrollments.length === 0) {
      toast("Agrega un servicio primero para poder registrarle un pago", "error");
      return;
    }
    if (contact.enrollments.length === 1) {
      setPaymentEnrollment(contact.enrollments[0]);
      return;
    }
    setPickedEnrollmentId(contact.enrollments[0].id);
    setPickEnrollmentOpen(true);
  };

  const isFocusNotebook = focusFromUrl && tab === "notas";

  const notebookProps = {
    contactId: contact.id,
    contactName: `${contact.firstName} ${contact.lastName ?? ""}`.trim(),
  };

  return (
    <div className={isFocusNotebook ? "crm-focus-workspace" : "space-y-4"}>
      {!isFocusNotebook && (
        <div className="space-y-3">
          <CrmPageHeader
            title={`${contact.firstName} ${contact.lastName ?? ""}`.trim()}
            backHref="/admin/contacts"
            backLabel="Contactos"
            trailing={
              contact.tags && contact.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {contact.tags.map(({ tag }) => (
                    <span
                      key={tag.id}
                      className="inline-flex rounded-full border border-terracotta/25 bg-terracotta/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-terracotta"
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              ) : undefined
            }
          />
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
                {serviceCount > 0 ? "Ver todos" : "Agregar"}
              </Button>
            </div>
            <Card className="overflow-hidden py-0">
              <CardContent className="divide-y divide-border p-0">
                {webinarRegistrations.slice(0, 2).map((r) => (
                  <WebinarServiceRow key={r.id} r={r} />
                ))}
                {serviceCount === 0 ? (
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
          {canWrite && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setAddEnrollmentOpen(true)}>
                Agregar servicio
              </Button>
            </div>
          )}
          <Card className="overflow-hidden py-0">
            <CardContent className="divide-y divide-border p-0">
              {webinarRegistrations.map((r) => (
                <WebinarServiceRow key={r.id} r={r} />
              ))}
              {serviceCount === 0 ? (
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
                      {canWrite && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPaymentEnrollment(en)}
                        >
                          {en.payments.some((p) => p.status === "APPROVED")
                            ? "Registrar otro pago"
                            : "Pago"}
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
        <section className="space-y-4">
          {canWrite && (
            <div className="flex justify-end">
              <Button size="sm" onClick={startRegisterPayment}>
                Registrar pago
              </Button>
            </div>
          )}
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
                      {formatMoneyMinor(p.amountMinor, p.currency)} {p.currency}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      )}

      <AddEnrollmentModal
        open={addEnrollmentOpen}
        onClose={() => setAddEnrollmentOpen(false)}
        contactId={contact.id}
        onSuccess={() => router.refresh()}
      />

      <CrmModal
        title="¿A qué servicio corresponde el pago?"
        open={pickEnrollmentOpen}
        onClose={() => setPickEnrollmentOpen(false)}
      >
        <div className="space-y-4 text-sm">
          <SearchableSelect
            id="pick-payment-enrollment"
            label="Servicio"
            value={pickedEnrollmentId}
            onChange={setPickedEnrollmentId}
            options={contact.enrollments.map((en) => ({
              value: en.id,
              label: en.product.title,
              hint: enrollmentStatusLabel(en.status),
            }))}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setPickEnrollmentOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!pickedEnrollmentId}
              onClick={() => {
                const en = contact.enrollments.find((e) => e.id === pickedEnrollmentId);
                if (!en) return;
                setPickEnrollmentOpen(false);
                setPaymentEnrollment(en);
              }}
            >
              Continuar
            </Button>
          </div>
        </div>
      </CrmModal>

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
        confirmTarget={deleteConfirmTarget}
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
