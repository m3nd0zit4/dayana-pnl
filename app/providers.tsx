"use client";

import { ReactNode } from "react";
import NavContext from "./context/NavContext";
import { PayPalModalProvider } from "./context/PayPalModalContext";
import { MercadoPagoCheckoutModalProvider } from "./context/MercadoPagoCheckoutModalContext";
import Stairs from "./components/common/Stairs";
import Navbar from "./components/Navigation/Navbar";
import FullScreenNav from "./components/Navigation/FullScreenNav";
import ScrollTriggerRefresher from "./components/common/ScrollTriggerRefresher";
import SmoothScroll from "./components/common/SmoothScroll";

const Providers = ({ children }: { children: ReactNode }) => {
  return (
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
};

export default Providers;
