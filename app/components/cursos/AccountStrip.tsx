import Link from "next/link";

import type { CatalogViewer } from "@/lib/courses/catalog";
import { OPERATIONAL_TZ } from "@/lib/crm/operational-timezone";

/**
 * Quién eres y en qué estado está tu acceso, en una línea.
 *
 * Es la mitad del encargo que la página no cubría: se veía el catálogo pero
 * no la cuenta, así que quien ya pagaba tenía que irse a `/acceso` y adivinar
 * a dónde llevaba. Aquí el estado se lee sin pulsar nada, y el único enlace
 * que hace falta lleva a donde de verdad se gestiona.
 *
 * No es un gate: sin sesión ofrece entrar o registrarse y la página sigue
 * completa por debajo. Ver los cursos nunca ha dependido de tener cuenta.
 */

const fmt = new Intl.DateTimeFormat("es-CO", {
  timeZone: OPERATIONAL_TZ,
  day: "numeric",
  month: "long",
});

const shell =
  "mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-5 sm:px-8";
const link =
  "font-[font2] text-[11px] uppercase tracking-[0.24em] underline underline-offset-4 transition-colors";

const AccountStrip = ({ viewer }: { viewer: CatalogViewer | null }) => {
  if (!viewer) {
    return (
      <div className="border-y border-black/10 bg-linen/30 py-4">
        <div className={shell}>
          <p className="font-[font1] text-[15px] text-black/60">
            ¿Ya compraste? Entra y sigue donde lo dejaste.
          </p>
          <div className="ml-auto flex items-center gap-5">
            <Link href="/acceso" className={`${link} text-black/70 hover:text-black`}>
              Entrar
            </Link>
            <Link
              href="/miembros/crear-cuenta"
              className={`${link} text-black/45 hover:text-black`}
            >
              Crear cuenta
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { membership, firstName, isOwner } = viewer;

  // El orden importa: lo permanente no vence, y lo vigente no se avisa de
  // renovar. Sólo el último caso es el que necesita una acción.
  const status = isOwner
    ? { text: "Estás viendo el portal como Dayana", tone: "calm" as const }
    : membership.lifetime
      ? { text: "Tu acceso es permanente", tone: "calm" as const }
      : membership.isCurrent
        ? {
            text:
              membership.daysLeft != null && membership.daysLeft <= 7
                ? `Tu membresía se renueva en ${membership.daysLeft} ${
                    membership.daysLeft === 1 ? "día" : "días"
                  }`
                : membership.paidUntil
                  ? `Membresía activa hasta el ${fmt.format(new Date(membership.paidUntil))}`
                  : "Membresía activa",
            tone: "calm" as const,
          }
        : membership.paidUntil
          ? {
              text: `Tu membresía venció el ${fmt.format(new Date(membership.paidUntil))}`,
              tone: "attention" as const,
            }
          : { text: "Todavía no tienes una membresía activa", tone: "attention" as const };

  return (
    <div className="border-y border-black/10 bg-linen/30 py-4">
      <div className={shell}>
        <p className="font-[font1] text-[15px] text-black/70">
          {/* El saludo se calla en el caso OWNER: su frase ya la nombra, y
              juntos quedaba «Hola, Dayana. Estás viendo el portal como
              Dayana». */}
          {firstName && !isOwner ? (
            <>
              <span className="text-black">Hola, {firstName}.</span>{" "}
            </>
          ) : null}
          <span className={status.tone === "attention" ? "text-terracotta" : undefined}>
            {status.text}
          </span>
        </p>
        <div className="ml-auto flex items-center gap-5">
          <Link
            href="/miembros/cuenta"
            className={`${link} text-black/70 hover:text-black`}
          >
            Mi cuenta
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AccountStrip;
