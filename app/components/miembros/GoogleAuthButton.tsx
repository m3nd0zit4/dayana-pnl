"use client";

import { signIn } from "next-auth/react";

/**
 * El botón de Google, en un solo sitio.
 *
 * Vivía incrustado dentro de `MemberSignInForm` — el formulario de **acceso**,
 * que es justo donde no llega quien viene a **registrarse**. Al sacarlo, el
 * alta de cuenta puede ofrecer la vía rápida sin duplicar treinta líneas de
 * SVG, y cualquier cambio (copy, tratamiento, telemetría) se hace una vez.
 *
 * `redirectTo` es la clave correcta en Auth.js v5. El destino importa: en el
 * camino de compra lleva `?autopay=<planId>`, que es lo que reanuda el pago
 * solo al volver de Google.
 */
const GoogleAuthButton = ({
  callbackUrl,
  label = "Continuar con Google",
}: {
  callbackUrl: string;
  label?: string;
}) => (
  <button
    type="button"
    onClick={() => signIn("google", { redirectTo: callbackUrl })}
    className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-border bg-card py-3.5 font-[font1] text-sm text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[0.03]"
  >
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 5.04c1.72 0 3.26.59 4.47 1.75l3.32-3.32C17.78 1.6 15.1.5 12 .5 7.42.5 3.44 3.13 1.5 6.96l3.87 3C6.29 7.14 8.9 5.04 12 5.04Z"
      />
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.94-.08-1.63-.26-2.35H12v4.45h6.56c-.13 1.1-.85 2.76-2.44 3.87l3.78 2.93c2.26-2.09 3.6-5.17 3.6-8.9Z"
      />
      <path
        fill="#FBBC05"
        d="M5.38 14.04a7.2 7.2 0 0 1-.38-2.29c0-.8.14-1.57.37-2.29l-3.87-3A11.96 11.96 0 0 0 .25 11.75c0 1.93.46 3.75 1.25 5.29l3.88-3Z"
      />
      <path
        fill="#34A853"
        d="M12 23c3.1 0 5.7-1.02 7.6-2.78l-3.78-2.93c-1.01.7-2.36 1.2-3.82 1.2-3.1 0-5.71-2.1-6.63-4.95l-3.87 3C3.44 20.37 7.42 23 12 23Z"
      />
    </svg>
    {label}
  </button>
);

export default GoogleAuthButton;
