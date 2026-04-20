"use client";

import { ReactNode } from "react";
import NavContext from "./context/NavContext";
import Stairs from "./components/common/Stairs";
import Navbar from "./components/Navigation/Navbar";
import FullScreenNav from "./components/Navigation/FullScreenNav";
import ScrollTriggerRefresher from "./components/common/ScrollTriggerRefresher";

const Providers = ({ children }: { children: ReactNode }) => {
  return (
    <NavContext>
      <ScrollTriggerRefresher />
      <Stairs>
        <div className="overflow-x-hidden">
          <Navbar />
          <FullScreenNav />
          {children}
        </div>
      </Stairs>
    </NavContext>
  );
};

export default Providers;
