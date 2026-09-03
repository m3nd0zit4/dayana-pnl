"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import NavContext from "./context/NavContext";
import { CheckoutModalProvider } from "./context/CheckoutModalContext";
import Stairs from "./components/common/Stairs";
import Navbar from "./components/Navigation/Navbar";
import FullScreenNav from "./components/Navigation/FullScreenNav";
import ScrollTriggerRefresher from "./components/common/ScrollTriggerRefresher";
import SmoothScroll from "./components/common/SmoothScroll";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";

const MarketingChrome = ({ children }: { children: ReactNode }) => (
  <NavContext>
    <CheckoutModalProvider>
      <SmoothScroll />
      <ScrollTriggerRefresher />
      <Stairs>
        <div className="overflow-x-hidden">
          <Navbar />
          <FullScreenNav />
          {children}
        </div>
      </Stairs>
      {/*
        Era el único grupo de rutas sin `<Toaster />`, y no se notaba mientras
        aquí sólo hubiera páginas de marketing. Ahora `/cuenta` se sirve por
        esta rama —salió del portal, que sí montaba el suyo— y es una pantalla
        de formularios: contraseña, sesiones, avisos. Un `toast.error` sin
        Toaster montado no falla, desaparece en silencio, que es la peor forma
        de perder el aviso de que algo no se guardó.
      */}
      <Toaster />
    </CheckoutModalProvider>
  </NavContext>
);

const ProvidersInner = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname() ?? "";
  const isAdmin = pathname.startsWith("/admin");
  // Portal de miembros + acceso: sin chrome de la landing (Stairs, navbar,
  // Lenis) — es un panel, no una página de marketing. Los modales de pago sí
  // se necesitan (renovación de membresía en /miembros/cuenta).
  const isPortal =
    pathname.startsWith("/miembros") || pathname.startsWith("/acceso");
  // Linktree-style link hub: meant to be a fast, chrome-free landing target
  // from social bios — skips the marketing site's Stairs transition/navbar.
  const isEnlaces = pathname.startsWith("/enlaces");
  // El cuestionario, y sólo el cuestionario: un embudo de pasos compite
  // consigo mismo si deja a la vista un menú, un enlace a "Terapias" y un
  // WhatsApp flotante — cada uno es una salida. La página de resultado
  // (/terapias/resultado/<token>) sí lleva el chrome completo, porque necesita
  // el modal de pago para su botón de compra.
  const isCuestionario = pathname === "/terapias/empezar";
  // La página de un pago acordado: nombre, precio, botón. Un enlace a
  // "Terapias" en la cabecera devolvería al catálogo justo a quien ya salió de
  // él y ya decidió. Necesita el modal de pago, así que no puede ir por la
  // rama sin proveedores de /enlaces.
  const isPagar = pathname.startsWith("/pagar/");

  // Dark mode is scoped to the CRM + member portal. It used to be scoped by
  // mounting ThemeProvider only on those routes — but next-themes renders an
  // inline <script> to set the class before paint, and a client-side
  // navigation from the marketing site into /miembros mounted that provider
  // (and its script) in the browser, where React 19 warns "Encountered a
  // script tag while rendering React component" and never executes it.
  //
  // So the provider is always mounted (its script ships in the SSR HTML, once)
  // and the scoping happens with `forcedTheme`: outside the panel and the
  // portal the theme is pinned to light, which is exactly what "no dark mode
  // here" means.
  const themed = isAdmin || isPortal;

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      forcedTheme={themed ? undefined : "light"}
    >
      {isAdmin ? (
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      ) : isEnlaces || isCuestionario ? (
        <>
          {children}
          <Toaster />
        </>
      ) : isPortal || isPagar ? (
        <CheckoutModalProvider>
          {children}
          <Toaster />
        </CheckoutModalProvider>
      ) : (
        <MarketingChrome>{children}</MarketingChrome>
      )}
    </ThemeProvider>
  );
};

// Client-side session read for UI that needs to react to auth state (e.g.
// the public header's logged-in indicator) without forcing every page into
// server-dynamic rendering — this repo has no Partial Prerendering enabled,
// so a server-side session read anywhere in the root layout's tree would
// opt every route out of static generation. useSession() sidesteps that
// entirely: it fetches after hydration, at the cost of a brief "logged out"
// flash before it resolves.
const Providers = ({ children }: { children: ReactNode }) => (
  <SessionProvider>
    <ProvidersInner>{children}</ProvidersInner>
  </SessionProvider>
);

export default Providers;
