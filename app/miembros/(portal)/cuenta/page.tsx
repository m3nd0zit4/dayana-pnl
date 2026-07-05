import type { Metadata } from "next";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { BRAND } from "@/lib/contact";
import { formatCop, formatUsd } from "@/lib/plans";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";
import { requirePortalContext } from "@/lib/lms/portal";
import { getMembershipPayments } from "@/lib/lms/membership";
import MembershipStatusCard from "@/app/components/miembros/MembershipStatusCard";
import RenewMembership from "@/app/components/miembros/RenewMembership";
import ChangePasswordForm from "@/app/components/miembros/ChangePasswordForm";

export const metadata: Metadata = {
  title: `Mi cuenta — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const PROVIDER_LABELS: Record<string, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Registro manual",
};

const formatAmount = (currency: string, amountMinor: number) =>
  currency === "COP"
    ? `${formatCop(amountMinor)} COP`
    : `${formatUsd(amountMinor / 100)} ${currency}`;

const Page = async () => {
  const { contact, account, membership } = await requirePortalContext();
  const { coursePlan, userCountry } = await getVisiblePublicPlans();

  const payments = membership.enrollment
    ? await getMembershipPayments(membership.enrollment.id)
    : [];

  const parsedPhone =
    contact.phoneE164.startsWith("+") && !contact.phoneE164.includes(":")
      ? parsePhoneNumberFromString(contact.phoneE164)
      : null;

  return (
    <div className="space-y-12">
      <div>
        <div className="mb-3 font-[font2] uppercase text-xs tracking-[0.4em] text-linen/70">
          Mi cuenta
        </div>
        <h1 className="font-[font2] uppercase text-3xl leading-[0.95] lg:text-5xl">
          {contact.displayName ?? contact.firstName}
        </h1>
        {contact.email ? (
          <p className="mt-3 font-[font1] text-sm text-white/55">
            {contact.email}
          </p>
        ) : null}
      </div>

      <MembershipStatusCard
        paidUntil={membership.paidUntil}
        isCurrent={membership.isCurrent}
        daysLeft={membership.daysLeft}
        hasEnrollment={membership.enrollment != null}
      />

      <section>
        <h2 className="mb-2 font-[font2] uppercase text-sm tracking-[0.3em] text-white/55">
          {membership.enrollment ? "Pagar mi mes" : "Activar membresía"}
        </h2>
        {coursePlan ? (
          <div className="max-w-md">
            <p className="font-[font1] text-sm leading-relaxed text-white/65">
              Cada pago suma un mes de acceso a las clases en vivo, grabaciones
              y módulos. Usa el correo con el que estás registrada aquí
              {contact.email ? (
                <>
                  {" "}
                  (<span className="text-white/85">{contact.email}</span>)
                </>
              ) : null}
              .
            </p>
            <RenewMembership
              plan={coursePlan}
              userCountry={userCountry}
              prefill={{
                email: contact.email,
                phone: parsedPhone?.nationalNumber ?? null,
                phoneCountry: parsedPhone?.country ?? contact.countryIso,
                firstName: contact.firstName,
                lastName: contact.lastName,
              }}
            />
          </div>
        ) : (
          <p className="font-[font1] text-sm text-white/50">
            El pago online no está disponible en este momento. Escríbenos por
            WhatsApp para renovar.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-[font2] uppercase text-sm tracking-[0.3em] text-white/55">
          Historial de pagos
        </h2>
        {payments.length > 0 ? (
          <ul className="divide-y divide-linen/10 rounded-2xl border border-linen/10">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-4"
              >
                <div className="font-[font1] text-sm text-white/85">
                  {formatAmount(payment.currency, payment.amountMinor)}
                </div>
                <div className="font-[font1] text-xs text-white/45">
                  {PROVIDER_LABELS[payment.provider] ?? payment.provider}
                  {" · "}
                  {(payment.paidAt ?? payment.createdAt).toLocaleDateString(
                    "es-CO",
                    { dateStyle: "medium" }
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-[font1] text-sm text-white/50">
            Aún no hay pagos registrados.
          </p>
        )}
      </section>

      <section className="max-w-md">
        <h2 className="mb-2 font-[font2] uppercase text-sm tracking-[0.3em] text-white/55">
          Contraseña
        </h2>
        {!account.passwordHash && account.googleSub ? (
          <p className="mb-4 font-[font1] text-sm leading-relaxed text-white/65">
            Entras con Google. Si quieres, crea también una contraseña para
            poder entrar con tu correo.
          </p>
        ) : null}
        <ChangePasswordForm hasPassword={Boolean(account.passwordHash)} />
      </section>
    </div>
  );
};

export default Page;
