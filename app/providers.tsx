"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import NavContext from "./context/NavContext";
import { PayPalModalProvider } from "./context/PayPalModalContext";
import { MercadoPagoCheckoutModalProvider } from "./context/MercadoPagoCheckoutModalContext";
import Stairs from "./components/common/Stairs";
import Navbar from "./components/Navigation/Navbar";
import FullScreenNav from "./components/Navigation/FullScreenNav";
import ScrollTriggerRefresher from "./components/common/ScrollTriggerRefresher";
import SmoothScroll from "./components/common/SmoothScroll";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";

const MarketingChrome = ({ children }: { children: ReactNode }) => (
  <NavContext>
    <PayPalModalProvider>
      <MercadoPagoCheckoutModalProvider>
        <SmoothScroll />
        <ScrollTriggerRefresher />
        <Stairs>
          <div className="overflow-x-hidden">
            <Navbar />
            <FullScreenNav />
            {children}
          </div>
        </Stairs>
      </MercadoPagoCheckoutModalProvider>
    </PayPalModalProvider>
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

  if (isAdmin) {
    return (
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    );
  }

  if (isPortal) {
    return (
      <PayPalModalProvider>
        <MercadoPagoCheckoutModalProvider>
          {children}
          <Toaster />
        </MercadoPagoCheckoutModalProvider>
      </PayPalModalProvider>
    );
  }

  return <MarketingChrome>{children}</MarketingChrome>;
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
