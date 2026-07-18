import { Suspense } from "react";
import MemberSignInForm from "../miembros/MemberSignInForm";

type AccountAccessCardProps = {
  title: string;
  description: string;
  /** Path (with query, if any) to return to once the visitor signs in. */
  callbackUrl: string;
  googleEnabled: boolean;
};

/**
 * "You need an account to continue" card with the real sign-in form embedded
 * inline — the visitor logs in (or jumps to signup) without leaving the page
 * they were about to pay on. Visual language matches MemberAuthShell's card
 * chrome, but with its own solid dark background so it reads correctly
 * wherever it's dropped, not just inside an already-black page shell.
 */
const AccountAccessCard = ({
  title,
  description,
  callbackUrl,
  googleEnabled,
}: AccountAccessCardProps) => {
  return (
    <div className="rounded-2xl border border-linen/15 bg-black p-6 sm:p-7 max-h-[85vh] overflow-y-auto">
      <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-white/60">
        {title}
      </div>
      <p className="font-[font1] mt-3 mb-6 text-white/82 leading-snug text-lg">
        {description}
      </p>

      <Suspense
        fallback={
          <p className="animate-pulse font-[font1] text-sm text-white/50">
            Cargando acceso…
          </p>
        }
      >
        <MemberSignInForm
          googleEnabled={googleEnabled}
          callbackUrl={callbackUrl}
        />
      </Suspense>
    </div>
  );
};

export default AccountAccessCard;
