"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import Link from "next/link";
import {
  Copy,
  CreditCard,
  GraduationCap,
  KeyRound,
  Mail,
  CalendarClock,
  UserPlus,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { CourseMemberRow } from "@/lib/lms/course-admin";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import ContactPickerField from "./ContactPickerField";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmMaybeShell from "./CrmMaybeShell";
import CrmModal from "./CrmModal";
import RegisterPaymentModal from "./RegisterPaymentModal";
import { useCrm } from "./CrmProvider";
import { CrmEmptyState, CrmPublicLink } from "./ui";
import { membershipChip } from "./membership-chip";

export type MemberFilter = "vencidas" | "por-vencer";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Props = {
  preview: boolean;
  courseTitle: string;
  courseProductId: string | null;
  initialMembers: CourseMemberRow[];
  /** Dentro de Membresías: sin marco ni cabecera propios. */
  embedded?: boolean;
  /** Filtro con el que llega desde «Para hoy». */
  initialFilter?: MemberFilter | null;
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
  courseProductId,
  initialMembers,
  embedded = false,
  initialFilter = null,
}: Props) => {
  const { canWrite, toast } = useCrm();
  const [rows, setRows] = useState<CourseMemberRow[]>(initialMembers);
  /*
    Mismo criterio que la cuenta de «Para hoy» (`lib/crm/pendientes.ts`):
    matrícula activa con `paidUntil` ya pasado, o que vence en los próximos
    siete días. Sin esto el enlace de la portada caía en la lista entera.
  */
  const [filter, setFilter] = useState<MemberFilter | null>(initialFilter);
  // «Ahora» se fija una vez por montaje: leer el reloj durante el render daría
  // un resultado distinto en cada render, y React lo prohíbe.
  const [nowMs] = useState(() => Date.now());
  const visibleRows =
    filter === null
      ? rows
      : rows.filter((r) => {
          if (r.status !== "ACTIVE" || !r.paidUntil) return false;
          const until = new Date(r.paidUntil).getTime();
          return filter === "vencidas"
            ? until < nowMs
            : until >= nowMs && until < nowMs + WEEK_MS;
        });
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<CourseMemberRow | null>(
    null
  );
  const [adjustTarget, setAdjustTarget] = useState<CourseMemberRow | null>(
    null
  );
  const [adjustDate, setAdjustDate] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [grantedAccess, setGrantedAccess] = useState<{
    name: string;
    email: string | null;
    password: string;
  } | null>(null);
  const [newMemberOpen, setNewMemberOpen] = useState(false);
  const [newMemberContactId, setNewMemberContactId] = useState("");
  const [newMemberError, setNewMemberError] = useState<string | null>(null);
  const [newMemberBusy, setNewMemberBusy] = useState(false);

  const addMember = async () => {
    if (!newMemberContactId || !courseProductId) return;
    setNewMemberBusy(true);
    setNewMemberError(null);
    const res = await fetch("/api/admin/enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contactId: newMemberContactId,
        productId: courseProductId,
        status: "ACTIVE",
      }),
    });
    setNewMemberBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setNewMemberError(
        data.error === "DUPLICATE_SERVICE"
          ? "Ese contacto ya tiene el curso pendiente."
          : "No se pudo agregar el miembro."
      );
      return;
    }
    toast("Miembro agregado — registra su pago o ajusta la vigencia");
    setNewMemberOpen(false);
    setNewMemberContactId("");
    void reload();
  };

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

  const grantAccess = async (row: CourseMemberRow) => {
    setGrantingId(row.contact.id);
    const res = await fetch(
      `/api/admin/lms/members/${row.contact.id}/grant-access`,
      { method: "POST" }
    );
    setGrantingId(null);
    if (!res.ok) {
      toast("No se pudo otorgar el acceso", "error");
      return;
    }
    const data = (await res.json()) as { email: string | null; password: string };
    setGrantedAccess({
      name: `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim(),
      email: data.email,
      password: data.password,
    });
    void reload();
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

  const newMemberAction =
    !preview && canWrite && courseProductId ? (
      <CrmNewButton
        label="Nuevo miembro"
        icon={UserPlus}
        onClick={() => {
          setNewMemberError(null);
          setNewMemberContactId("");
          setNewMemberOpen(true);
        }}
      />
    ) : undefined;

  return (
    <CrmMaybeShell embedded={embedded}>
      {embedded ? (
        newMemberAction ? (
          <div className="flex justify-end">{newMemberAction}</div>
        ) : null
      ) : (
        <CrmPageHeader
          title="Curso · Miembros"
          description={`Membresías mensuales de «${courseTitle}». Cada pago aprobado suma un mes de acceso al portal.`}
          secondaryActions={
            <CrmPublicLink href="/cursos" label="Ver cursos en la web" />
          }
          action={newMemberAction}
        />
      )}

      <div className="space-y-6">
        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {filter !== null && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  {filter === "vencidas"
                    ? "Membresías vencidas"
                    : "Membresías que vencen esta semana"}
                  : {visibleRows.length}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  onClick={() => setFilter(null)}
                >
                  Ver todas
                </button>
              </div>
            )}
            {rows.length === 0 && (
              <CrmEmptyState
                icon={GraduationCap}
                title="Sin miembros todavía"
                description="Se crean al pagar el curso o al vincular el producto desde un contacto."
              />
            )}
            {visibleRows.map((row) => {
              const chip = membershipChip(row);
              return (
                <div key={row.enrollmentId} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link
                        href={preview ? "#" : `/admin/contacts/${row.contact.id}`}
                        className="text-sm font-semibold hover:underline"
                      >
                        {row.contact.firstName} {row.contact.lastName ?? ""}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {row.contact.email ?? "Sin email"} ·{" "}
                        {displayContactPhone(row.contact.phoneE164) ?? "Sin teléfono"}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
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
                      <Badge className={chip.cls}>{chip.label}</Badge>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Vigente hasta: {formatDate(row.paidUntil)}
                      </div>

                      {!preview && canWrite && (
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
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
                            <Mail aria-hidden />
                            {invitingId === row.contact.id
                              ? "Enviando…"
                              : row.hasAccount
                                ? "Reenviar acceso"
                                : "Invitar"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={grantingId === row.contact.id}
                            onClick={() => void grantAccess(row)}
                            title="Genera una contraseña directa, sin depender del correo"
                          >
                            <KeyRound aria-hidden />
                            {grantingId === row.contact.id
                              ? "Generando…"
                              : "Otorgar acceso"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPaymentTarget(row)}
                          >
                            <CreditCard aria-hidden />
                            Registrar pago
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAdjustTarget(row);
                              setAdjustDate(toDateInputValue(row.paidUntil));
                            }}
                          >
                            <CalendarClock aria-hidden />
                            Ajustar vigencia
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
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
          <p className="text-sm text-muted-foreground">
            Fija hasta cuándo tiene acceso{" "}
            <strong>
              {adjustTarget?.contact.firstName}{" "}
              {adjustTarget?.contact.lastName ?? ""}
            </strong>
            . Deja el campo vacío para quitar la vigencia.
          </p>
          <div className="space-y-1.5">
            <Label>Vigente hasta</Label>
            <Input
              type="date"
              value={adjustDate}
              onChange={(e) => setAdjustDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>
              Cancelar
            </Button>
            <Button disabled={adjustSaving} onClick={() => void saveAdjust()}>
              {adjustSaving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      </CrmModal>

      <CrmModal
        title="Nuevo miembro"
        open={newMemberOpen}
        onClose={() => setNewMemberOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            El miembro debe existir como contacto. Búscalo aquí; si aún no
            está registrado,{" "}
            <Link href="/admin/contacts" className="text-primary underline-offset-4 hover:underline">
              créalo primero en Contactos
            </Link>
            .
          </p>
          <ContactPickerField
            id="nm-contact"
            label="Contacto *"
            value={newMemberContactId}
            onSelect={(c) => setNewMemberContactId(c?.id ?? "")}
            required
          />
          <p className="text-xs text-muted-foreground">
            Se crea la inscripción al curso sin vigencia. Después registra su
            pago («Registrar pago») o fija la fecha («Ajustar vigencia») y
            envíale el acceso al portal.
          </p>
          {newMemberError && (
            <p className="text-sm text-destructive" role="alert">
              {newMemberError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewMemberOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={newMemberBusy || !newMemberContactId}
              onClick={() => void addMember()}
            >
              {newMemberBusy ? "Agregando…" : "Agregar miembro"}
            </Button>
          </div>
        </div>
      </CrmModal>

      <CrmModal
        title="Acceso otorgado"
        open={!!grantedAccess}
        onClose={() => setGrantedAccess(null)}
      >
        {grantedAccess && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Comparte esto con <strong>{grantedAccess.name}</strong> por
              WhatsApp o el canal que uses — no se muestra de nuevo.
            </p>
            <div className="space-y-1.5">
              <Label>Correo</Label>
              <Input readOnly value={grantedAccess.email ?? "Sin email registrado"} />
            </div>
            <div className="space-y-1.5">
              <Label>Contraseña</Label>
              <div className="flex gap-2">
                <Input readOnly value={grantedAccess.password} className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copiar contraseña"
                  onClick={() => {
                    void navigator.clipboard.writeText(grantedAccess.password);
                    toast("Contraseña copiada");
                  }}
                >
                  <Copy />
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setGrantedAccess(null)}>Listo</Button>
            </div>
          </div>
        )}
      </CrmModal>
    </CrmMaybeShell>
  );
};

export default CourseMembersPageClient;
