"use client";

import type { ContactSource } from "@prisma/client";
import Link from "next/link";
import { ChevronRight, Copy, CreditCard, MessageCircle, Pencil, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import ContactEditForm from "@/app/components/admin/crm/ContactEditForm";
import DeleteContactDialog from "@/app/components/admin/crm/DeleteContactDialog";
import QuickMessagesPanel from "@/app/components/admin/crm/QuickMessagesPanel";
import CrmNewButton from "@/app/components/admin/crm/CrmNewButton";
import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmSegmentedControl from "@/app/components/admin/crm/CrmSegmentedControl";
import RegisterPaymentFlow from "@/app/components/admin/crm/RegisterPaymentFlow";
import AddEnrollmentModal from "@/app/components/admin/crm/AddEnrollmentModal";
import { formatMoneyMinor } from "@/lib/crm/money";
import {
  contactDeleteConfirmationTarget,
  displayContactPhone,
} from "@/lib/crm/contact-phone";
import { contactFilterSourceSelectOptions } from "@/lib/crm/form-select-options";
import { formatCountryLabel } from "@/lib/countries";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { saveContactRecent } from "@/lib/crm/contact-search-recents";
import type { ContactDiagnosticSummary } from "@/lib/crm/diagnostics";

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

/** «2 pagos · 160 USD» con lo aprobado; lo rechazado no cuenta como cobrado. */
const paymentSummary = (en: Enrollment): string => {
  const approved = en.payments.filter((p) => p.status === "APPROVED");
  if (approved.length === 0) return "Sin pagos";
  const label = `${approved.length} ${approved.length === 1 ? "pago" : "pagos"}`;
  const currency = approved[0].currency;
  // Nunca se suman monedas distintas: el número no significaría nada.
  if (approved.some((p) => p.currency !== currency)) return label;
  const total = approved.reduce((sum, p) => sum + p.amountMinor, 0);
  return `${label} · ${formatMoneyMinor(total, currency)} ${currency}`;
};

/**
 * Fecha con la zona operativa fija: el servidor corre en UTC y el navegador en
 * Bogotá, y sin `timeZone` el HTML de cada lado no coincidía al hidratar.
 */
const formatDiagnosticDate = (iso: string | null, timeZone: string): string | null =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", { dateStyle: "medium", timeZone })
    : null;

/**
 * Tarjeta de resumen del último diagnóstico completado. Solo el más reciente
 * se despliega entero; los anteriores quedan como enlaces a su detalle, para
 * que ninguno se quede sin poder abrirse desde la ficha.
 */
const DiagnosticoCard = ({
  diagnostics,
  timeZone,
}: {
  diagnostics: ContactDiagnosticSummary[];
  timeZone: string;
}) => {
  if (diagnostics.length === 0) return null;
  const [latest, ...older] = diagnostics;
  const answered = latest.answers.filter((a) => a.answers.length > 0).slice(0, 3);
  const metaParts = [
    formatDiagnosticDate(latest.completedAt, timeZone),
    latest.recommendedProductTitle ? `Recomendado: ${latest.recommendedProductTitle}` : null,
  ].filter((v): v is string => Boolean(v));

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Diagnóstico</h2>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href={`/admin/diagnosticos/${latest.id}`} />}
          >
            Ver todas las respuestas
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {latest.profileName ? <Badge variant="secondary">{latest.profileName}</Badge> : null}
          {latest.profileName && metaParts.length > 0 ? (
            <span className="text-muted-foreground">·</span>
          ) : null}
          {metaParts.length > 0 ? (
            <span className="text-muted-foreground">{metaParts.join(" · ")}</span>
          ) : null}
        </div>
        {answered.length > 0 ? (
          <div className="space-y-2">
            {answered.map((item) => (
              <div key={item.id}>
                <p className="text-xs text-muted-foreground">{item.question}</p>
                <p className="text-sm">{item.answers.join(" · ")}</p>
              </div>
            ))}
          </div>
        ) : null}
        {older.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Diagnósticos anteriores</p>
            <ul className="space-y-1">
              {older.slice(0, 5).map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/admin/diagnosticos/${d.id}`}
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    {[formatDiagnosticDate(d.completedAt, timeZone), d.profileName]
                      .filter(Boolean)
                      .join(" · ") || "Ver diagnóstico"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
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

const DataField = ({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) => (
  <div className={wide ? "sm:col-span-2" : undefined}>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 break-words">{children}</dd>
  </div>
);

const TABS = [
  { id: "resumen" as const, label: "Resumen" },
  { id: "servicios" as const, label: "Servicios y pagos" },
];
type Tab = (typeof TABS)[number]["id"];

/** `?tab=pagos` era la pestaña de pagos: ahora vive dentro de Servicios y pagos. */
const tabFromParam = (value: string | null): Tab =>
  value === "servicios" || value === "pagos" ? "servicios" : "resumen";

/**
 * La ficha de un contacto.
 *
 * Abre en lectura: lo que se busca al entrar es un teléfono, una nota o si ya
 * pagó, no un formulario de catorce campos. Editar y eliminar existen, pero se
 * piden. «Registrar pago» va en la cabecera y funciona aunque la persona
 * todavía no tenga ningún servicio: el flujo lo crea.
 */
const ContactDetailClient = ({
  contact: initial,
  diagnostics = [],
  timeZone = "America/Bogota",
}: {
  contact: Contact;
  diagnostics?: ContactDiagnosticSummary[];
  /** Zona operativa resuelta en el servidor, para formatear fechas igual en los dos lados. */
  timeZone?: string;
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite, canRecordPayments, toast } = useCrm();
  // Sin ediciones locales del contacto: usar el prop directo hace que
  // router.refresh() traiga siempre el estado fresco del servidor.
  const contact = initial;
  const fullName = `${contact.firstName} ${contact.lastName ?? ""}`.trim();
  const webinarRegistrations = contact.webinarRegistrations ?? [];
  const serviceCount = contact.enrollments.length + webinarRegistrations.length;
  const [tab, setTab] = useState<Tab>(tabFromParam(searchParams.get("tab")));
  const [editing, setEditing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [addEnrollmentOpen, setAddEnrollmentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    const t = searchParams.get("tab");
    if (t !== null) setTab(tabFromParam(t));
  }, [searchParams]);

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

  const phone = displayContactPhone(contact.phoneE164);
  const whatsAppUrl = buildContactWhatsAppUrl(contact.phoneE164);
  const sourceLabel =
    contactFilterSourceSelectOptions().find((o) => o.value === contact.source)?.label ??
    contact.source;

  const copyPhone = async () => {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      toast("Número copiado");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  return (
    <div className="space-y-4">
      <CrmPageHeader
        title={fullName}
        backHref="/admin/contacts"
        backLabel="Contactos"
        secondaryActions={
          whatsAppUrl ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={whatsAppUrl} target="_blank" rel="noopener noreferrer" />}
            >
              <MessageCircle aria-hidden />
              WhatsApp
            </Button>
          ) : undefined
        }
        action={
          canRecordPayments ? (
            <CrmNewButton
              label="Registrar pago"
              icon={CreditCard}
              onClick={() => setRegistering(true)}
            />
          ) : undefined
        }
        trailing={
          <div className="space-y-3">
            {contact.tags && contact.tags.length > 0 ? (
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
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CrmSegmentedControl
                value={tab}
                onChange={goToTab}
                segments={TABS}
                aria-label="Secciones del contacto"
              />
              {tab === "servicios" && canWrite ? (
                <Button variant="outline" size="sm" onClick={() => setAddEnrollmentOpen(true)}>
                  <Plus aria-hidden />
                  Agregar servicio
                </Button>
              ) : null}
            </div>
          </div>
        }
      />

      {tab === "resumen" && (
        <>
          {editing ? (
            <>
              <ContactEditForm
                contact={contact}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  router.refresh();
                }}
              />
              {canWrite ? (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteOpen(true);
                    }}
                  >
                    Eliminar contacto…
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Datos</h2>
                  {canWrite ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                      <Pencil aria-hidden />
                      Editar
                    </Button>
                  ) : null}
                </div>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  {contact.notes ? (
                    <DataField label="Notas" wide>
                      <span className="block whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2">
                        {contact.notes}
                      </span>
                    </DataField>
                  ) : null}
                  <DataField label="Teléfono">
                    {phone ? (
                      <span className="inline-flex items-center gap-1 font-mono">
                        {phone}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Copiar número"
                          title="Copiar número"
                          onClick={() => void copyPhone()}
                        >
                          <Copy aria-hidden />
                        </Button>
                      </span>
                    ) : (
                      "Sin teléfono"
                    )}
                  </DataField>
                  <DataField label="Email">{contact.email ?? "—"}</DataField>
                  <DataField label="País">
                    {contact.countryIso ? formatCountryLabel(contact.countryIso) : "—"}
                  </DataField>
                  <DataField label="Origen">
                    {sourceLabel}
                    {contact.sourceDetail ? ` · ${contact.sourceDetail}` : ""}
                  </DataField>
                  {contact.tiktokHandle ? (
                    <DataField label="TikTok">{contact.tiktokHandle}</DataField>
                  ) : null}
                  <DataField label="Consentimientos">
                    Datos: {contact.consentDataAt ? "sí" : "no"} · Marketing:{" "}
                    {contact.consentMarketingAt ? "sí" : "no"}
                  </DataField>
                </dl>
              </CardContent>
            </Card>
          )}
          <DiagnosticoCard diagnostics={diagnostics} timeZone={timeZone} />
          <Card>
            <CardContent>
              <QuickMessagesPanel vars={messageVars} />
            </CardContent>
          </Card>
        </>
      )}

      {tab === "servicios" && (
        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {webinarRegistrations.map((r) => (
              <WebinarServiceRow key={r.id} r={r} />
            ))}
            {serviceCount === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Sin servicios todavía.
                {canRecordPayments ? " Registrar un pago crea el servicio." : ""}
              </p>
            ) : (
              contact.enrollments.map((en) => (
                <Link
                  key={en.id}
                  href={`/admin/enrollments/${en.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{en.product.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {enrollmentStatusLabel(en.status)}
                      {en.sessionsTotal != null &&
                        ` · ${en.sessionsUsed}/${en.sessionsTotal} sesiones`}
                      {" · "}
                      {paymentSummary(en)}
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
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <AddEnrollmentModal
        open={addEnrollmentOpen}
        onClose={() => setAddEnrollmentOpen(false)}
        contactId={contact.id}
        onSuccess={() => router.refresh()}
      />

      {canRecordPayments ? (
        <RegisterPaymentFlow
          open={registering}
          onClose={() => setRegistering(false)}
          contact={{ id: contact.id, name: fullName }}
          onSuccess={() => router.refresh()}
        />
      ) : null}

      <DeleteContactDialog
        open={deleteOpen}
        contactName={fullName}
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
