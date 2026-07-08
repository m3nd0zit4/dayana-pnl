"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
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

const Providers = ({ children }: { children: ReactNode }) => {
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
        </MercadoPagoCheckoutModalProvider>
      </PayPalModalProvider>
    );
  }

  return <MarketingChrome>{children}</MarketingChrome>;
};

export default Providers;
