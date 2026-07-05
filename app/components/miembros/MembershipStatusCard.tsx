import Link from "next/link";

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
      ? { label: "Vence pronto", cls: "bg-blush/15 text-blush" }
      : { label: "Al día", cls: "bg-linen/15 text-linen" }
    : { label: hasEnrollment ? "Vencida" : "Sin activar", cls: "bg-white/10 text-white/60" };

  return (
    <div className="rounded-2xl border border-linen/15 bg-linen/[0.04] p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="font-[font2] uppercase text-xs tracking-[0.3em] text-white/55">
          Tu membresía
        </div>
        <span
          className={`rounded-full px-3 py-1 font-[font2] uppercase text-[10px] tracking-[0.2em] ${chip.cls}`}
        >
          {chip.label}
        </span>
      </div>

      <div className="mt-4 font-[font1] text-sm leading-relaxed text-white/75">
        {isCurrent && paidUntil ? (
          <>
            Tienes acceso hasta el{" "}
            <span className="text-white">{formatDate(paidUntil)}</span>
            {daysLeft != null ? (
              <span className="text-white/50"> · {daysLeft} día{daysLeft === 1 ? "" : "s"}</span>
            ) : null}
            .
          </>
        ) : hasEnrollment && paidUntil ? (
          <>
            Tu mensualidad venció el{" "}
            <span className="text-white">{formatDate(paidUntil)}</span>. Renueva
            para recuperar el acceso a clases, grabaciones y módulos.
          </>
        ) : (
          <>Activa tu mensualidad para acceder a las clases en vivo, grabaciones y módulos.</>
        )}
      </div>

      {(!isCurrent || expiringSoon) && (
        <Link
          href="/miembros/cuenta"
          className="mt-5 inline-block rounded-full bg-linen px-7 py-3 font-[font2] uppercase text-xs tracking-[0.25em] text-black transition-colors hover:bg-white"
        >
          {isCurrent ? "Renovar ahora" : hasEnrollment ? "Renovar mi mes" : "Activar membresía"}
        </Link>
      )}
    </div>
  );
};

export default MembershipStatusCard;
