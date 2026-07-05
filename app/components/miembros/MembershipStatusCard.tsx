import Link from "next/link";
import { CalendarClock } from "lucide-react";

type MembershipStatusCardProps = {
  paidUntil: Date | null;
  isCurrent: boolean;
  daysLeft: number | null;
  hasEnrollment: boolean;
};

const formatDate = (date: Date) =>
  date.toLocaleDateString("es-CO", { dateStyle: "long" });

const MembershipStatusCard = ({
  paidUntil,
  isCurrent,
  daysLeft,
  hasEnrollment,
}: MembershipStatusCardProps) => {
  const expiringSoon = isCurrent && daysLeft != null && daysLeft <= 7;

  const chip = isCurrent
    ? expiringSoon
      ? { label: "Vence pronto", cls: "bg-amber-100 text-amber-700" }
      : { label: "Al día", cls: "bg-emerald-100 text-emerald-700" }
    : {
        label: hasEnrollment ? "Vencida" : "Sin activar",
        cls: "bg-neutral-200 text-neutral-600",
      };

  return (
    <div className="portal-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="portal-display flex items-center gap-2 text-[11px] text-[var(--portal-muted)]">
          <CalendarClock className="size-4" aria-hidden />
          Tu membresía
        </div>
        <span
          className={`portal-display rounded-full px-3 py-1 text-[10px] ${chip.cls}`}
        >
          {chip.label}
        </span>
      </div>

      <div className="mt-3 text-sm leading-relaxed text-[#33302b]">
        {isCurrent && paidUntil ? (
          <>
            Tienes acceso hasta el{" "}
            <strong>{formatDate(paidUntil)}</strong>
            {daysLeft != null ? (
              <span className="text-[var(--portal-muted)]">
                {" "}
                · {daysLeft} día{daysLeft === 1 ? "" : "s"}
              </span>
            ) : null}
            .
          </>
        ) : hasEnrollment && paidUntil ? (
          <>
            Tu mensualidad venció el <strong>{formatDate(paidUntil)}</strong>.
            Renueva para recuperar el acceso a clases, grabaciones y módulos.
          </>
        ) : (
          <>
            Activa tu mensualidad para acceder a las clases en vivo,
            grabaciones y módulos.
          </>
        )}
      </div>

      {(!isCurrent || expiringSoon) && (
        <Link href="/miembros/cuenta" className="portal-btn-primary mt-4">
          {isCurrent
            ? "Renovar ahora"
            : hasEnrollment
              ? "Renovar mi mes"
              : "Activar membresía"}
        </Link>
      )}
    </div>
  );
};

export default MembershipStatusCard;
