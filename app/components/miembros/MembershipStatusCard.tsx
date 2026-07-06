import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

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
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground uppercase tracking-wide">
            <CalendarClock className="size-4" aria-hidden />
            Tu membresía
          </div>
          <Badge className={chip.cls}>{chip.label}</Badge>
        </div>

        <div className="mt-3 text-sm leading-relaxed">
          {isCurrent && paidUntil ? (
            <>
              Tienes acceso hasta el <strong>{formatDate(paidUntil)}</strong>
              {daysLeft != null ? (
                <span className="text-muted-foreground">
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
          <Button className="mt-4" render={<Link href="/miembros/cuenta" />}>
            {isCurrent
              ? "Renovar ahora"
              : hasEnrollment
                ? "Renovar mi mes"
                : "Activar membresía"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default MembershipStatusCard;
