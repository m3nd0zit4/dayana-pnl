import Link from "next/link";

type AccountAccessCardProps = {
  title: string;
  description: string;
  /** Path (with query, if any) to return to once the visitor has an account. */
  callbackUrl: string;
};

/**
 * Reusable "you need an account to continue" card. Visual language matches
 * the real login/signup pages (see MemberAuthShell's card chrome), but with
 * its own solid dark background rather than that page's subtle on-black
 * tint — this card needs to read correctly wherever it's dropped, not just
 * inside an already-black page shell.
 */
const AccountAccessCard = ({
  title,
  description,
  callbackUrl,
}: AccountAccessCardProps) => {
  const encodedCallback = encodeURIComponent(callbackUrl);

  return (
    <div className="rounded-2xl border border-linen/15 bg-black p-6 sm:p-7">
      <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-white/60">
        {title}
      </div>
      <p className="font-[font1] mt-4 text-white/82 leading-snug text-lg">
        {description}
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <Link
          href={`/miembros/crear-cuenta?callbackUrl=${encodedCallback}`}
          className="inline-flex items-center justify-center rounded-full bg-linen px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.2em] text-black transition-colors hover:bg-white"
        >
          Crear cuenta
        </Link>
        <Link
          href={`/acceso?callbackUrl=${encodedCallback}`}
          className="inline-flex items-center justify-center rounded-full border border-white/35 bg-white/10 px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.2em] text-white transition-colors hover:bg-white/20"
        >
          Ya tengo cuenta
        </Link>
      </div>
    </div>
  );
};

export default AccountAccessCard;
