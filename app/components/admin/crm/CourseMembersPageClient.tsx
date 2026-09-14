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
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import ContactPickerField from "./ContactPickerField";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmMaybeShell from "./CrmMaybeShell";
import CrmModal from "./CrmModal";
import RegisterPaymentFlow from "./RegisterPaymentFlow";
import { useCrm } from "./CrmProvider";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmFormActions,
  CrmPublicLink,
  CrmRowAction,
  CrmRowActions,
} from "./ui";
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
  /**
   * Embebido, el botón «Nuevo miembro» lo pinta la cabecera de Membresías y
   * este componente sólo abre el diálogo.
   */
  newMemberOpen?: boolean;
  onNewMemberOpenChange?: (open: boolean) => void;
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

const memberName = (row: CourseMemberRow) =>
  `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim();

/**
 * Miembros del curso.
 *
 * Cada fila tenía cuatro botones con texto —Invitar, Otorgar acceso, Registrar
 * pago, Ajustar vigencia— y dos de ellos eran la misma pregunta: cómo entra
 * esta persona al portal. Ahora son tres iconos: acceso al portal (que agrupa
 * invitar y la contraseña directa), pago y vigencia.
 */
const CourseMembersPageClient = ({
  preview,
  courseTitle,
  courseProductId,
  initialMembers,
  embedded = false,
  initialFilter = null,
  newMemberOpen: controlledNewMemberOpen,
  onNewMemberOpenChange,
}: Props) => {
  const { canWrite, canRecordPayments, toast } = useCrm();
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
  const [accessTarget, setAccessTarget] = useState<CourseMemberRow | null>(null);
  const [inviting, setInviting] = useState(false);
  const [granting, setGranting] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<CourseMemberRow | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<CourseMemberRow | null>(null);
  const [adjustDate, setAdjustDate] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [grantedAccess, setGrantedAccess] = useState<{
    name: string;
    email: string | null;
    password: string;
  } | null>(null);
  const [localNewMemberOpen, setLocalNewMemberOpen] = useState(false);
  const newMemberOpen = controlledNewMemberOpen ?? localNewMemberOpen;
  const setNewMemberOpen = (open: boolean) =>
    onNewMemberOpenChange ? onNewMemberOpenChange(open) : setLocalNewMemberOpen(open);
  const [newMemberContactId, setNewMemberContactId] = useState("");
  const [newMemberError, setNewMemberError] = useState<string | null>(null);
  const [newMemberBusy, setNewMemberBusy] = useState(false);

  // Cada vez que se abre el diálogo, empieza limpio.
  const [wasNewMemberOpen, setWasNewMemberOpen] = useState(newMemberOpen);
  if (newMemberOpen !== wasNewMemberOpen) {
    setWasNewMemberOpen(newMemberOpen);
    if (newMemberOpen) {
      setNewMemberContactId("");
      setNewMemberError(null);
    }
  }

  const reload = useCallback(async () => {
    if (preview) return;
    const res = await fetch("/api/admin/lms/members");
    if (!res.ok) return;
    const data = (await res.json()) as { members?: CourseMemberRow[] };
    if (data.members) setRows(data.members);
  }, [preview]);

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

  const invite = async (row: CourseMemberRow) => {
    setInviting(true);
    const res = await fetch(
      `/api/admin/lms/members/${row.contact.id}/invite`,
      { method: "POST" }
    );
    setInviting(false);
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
    setAccessTarget(null);
  };

  const grantAccess = async (row: CourseMemberRow) => {
    setGranting(true);
    const res = await fetch(
      `/api/admin/lms/members/${row.contact.id}/grant-access`,
      { method: "POST" }
    );
    setGranting(false);
    if (!res.ok) {
      toast("No se pudo otorgar el acceso", "error");
      return;
    }
    const data = (await res.json()) as { email: string | null; password: string };
    setAccessTarget(null);
    setGrantedAccess({
      name: memberName(row),
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

  return (
    <CrmMaybeShell embedded={embedded}>
      {!embedded && (
        <CrmPageHeader
          title="Curso · Miembros"
          description={`Membresías mensuales de «${courseTitle}». Cada pago aprobado suma un mes de acceso al portal.`}
          secondaryActions={
            <CrmPublicLink href="/cursos" label="Ver cursos en la web" />
          }
          action={
            !preview && canWrite && courseProductId ? (
              <CrmNewButton
                label="Nuevo miembro"
                icon={UserPlus}
                onClick={() => setNewMemberOpen(true)}
              />
            ) : undefined
          }
        />
      )}

      {filter !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm">
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

      <CrmDataList>
        {rows.length === 0 ? (
          <CrmEmptyState
            icon={GraduationCap}
            title="Sin miembros todavía"
            description="Se crean al pagar el curso o al vincular el producto desde un contacto."
          />
        ) : (
          visibleRows.map((row) => {
            const chip = membershipChip(row);
            return (
              <CrmDataListRow
                key={row.enrollmentId}
                className="items-start"
                actions={
                  !preview && canWrite ? (
                    <CrmRowActions>
                      <CrmRowAction
                        icon={KeyRound}
                        label="Acceso al portal"
                        onClick={() => setAccessTarget(row)}
                      />
                      {canRecordPayments ? (
                        <>
                          <CrmRowAction
                            icon={CreditCard}
                            label="Registrar pago"
                            onClick={() => setPaymentTarget(row)}
                          />
                          <CrmRowAction
                            icon={CalendarClock}
                            label="Ajustar vigencia"
                            onClick={() => {
                              setAdjustTarget(row);
                              setAdjustDate(toDateInputValue(row.paidUntil));
                            }}
                          />
                        </>
                      ) : null}
                    </CrmRowActions>
                  ) : undefined
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={preview ? "#" : `/admin/contacts/${row.contact.id}`}
                      className="text-sm font-semibold hover:underline"
                    >
                      {memberName(row)}
                    </Link>
                    <Badge className={chip.cls}>{chip.label}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Vigente hasta {formatDate(row.paidUntil)} · Último pago{" "}
                    {formatDate(row.lastPaymentAt)} ({row.paymentsCount})
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {row.contact.email ?? "Sin email"} ·{" "}
                    {displayContactPhone(row.contact.phoneE164) ?? "Sin teléfono"} ·
                    Portal: {row.hasAccount ? "cuenta activa" : "sin cuenta"}
                  </div>
                </div>
              </CrmDataListRow>
            );
          })
        )}
      </CrmDataList>

      {paymentTarget && (
        <RegisterPaymentFlow
          open={!!paymentTarget}
          onClose={() => setPaymentTarget(null)}
          contact={{ id: paymentTarget.contact.id, name: memberName(paymentTarget) }}
          enrollment={{
            id: paymentTarget.enrollmentId,
            productTitle: courseTitle,
            amountMinor: paymentTarget.amountMinor,
            currency: paymentTarget.currency ?? "USD",
          }}
          onSuccess={() => void reload()}
        />
      )}

      <CrmModal
        title="Acceso al portal"
        open={!!accessTarget}
        onClose={() => setAccessTarget(null)}
      >
        {accessTarget && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              <strong className="font-medium text-foreground">
                {memberName(accessTarget)}
              </strong>{" "}
              {accessTarget.hasAccount
                ? "ya tiene cuenta en el portal."
                : "todavía no tiene cuenta en el portal."}
            </p>
            <div className="space-y-2">
              <Button
                className="w-full"
                disabled={inviting || !accessTarget.contact.email}
                onClick={() => void invite(accessTarget)}
              >
                <Mail aria-hidden />
                {inviting
                  ? "Enviando…"
                  : accessTarget.hasAccount
                    ? "Reenviar acceso por correo"
                    : "Enviar invitación por correo"}
              </Button>
              {!accessTarget.contact.email ? (
                <p className="text-xs text-muted-foreground">
                  No tiene email: genera una contraseña y compártela por WhatsApp.
                </p>
              ) : null}
              <Button
                variant="outline"
                className="w-full"
                disabled={granting}
                onClick={() => void grantAccess(accessTarget)}
              >
                <KeyRound aria-hidden />
                {granting ? "Generando…" : "Generar contraseña directa"}
              </Button>
              <p className="text-xs text-muted-foreground">
                La contraseña se muestra una sola vez, sin depender del correo.
              </p>
            </div>
            <CrmFormActions>
              <Button variant="ghost" onClick={() => setAccessTarget(null)}>
                Cerrar
              </Button>
            </CrmFormActions>
          </div>
        )}
      </CrmModal>

      <CrmModal
        title="Ajustar vigencia"
        open={!!adjustTarget}
        onClose={() => setAdjustTarget(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Fija hasta cuándo tiene acceso{" "}
            <strong>{adjustTarget ? memberName(adjustTarget) : ""}</strong>
            . Deja el campo vacío para quitar la vigencia.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-paid-until">Vigente hasta</Label>
            <Input
              id="adjust-paid-until"
              type="date"
              value={adjustDate}
              onChange={(e) => setAdjustDate(e.target.value)}
            />
          </div>
          <CrmFormActions>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>
              Cancelar
            </Button>
            <Button disabled={adjustSaving} onClick={() => void saveAdjust()}>
              {adjustSaving ? "Guardando…" : "Guardar"}
            </Button>
          </CrmFormActions>
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
            Se crea la inscripción al curso sin vigencia. Después, desde su
            fila, registra el pago o ajusta la vigencia, y envíale el acceso al
            portal.
          </p>
          {newMemberError && (
            <p className="text-sm text-destructive" role="alert">
              {newMemberError}
            </p>
          )}
          <CrmFormActions>
            <Button variant="outline" onClick={() => setNewMemberOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={newMemberBusy || !newMemberContactId}
              onClick={() => void addMember()}
            >
              {newMemberBusy ? "Agregando…" : "Agregar miembro"}
            </Button>
          </CrmFormActions>
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
            <CrmFormActions>
              <Button onClick={() => setGrantedAccess(null)}>Listo</Button>
            </CrmFormActions>
          </div>
        )}
      </CrmModal>
    </CrmMaybeShell>
  );
};

export default CourseMembersPageClient;
