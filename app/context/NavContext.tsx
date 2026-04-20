"use client";

import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useState,
} from "react";

type NavOpenContextValue = [boolean, Dispatch<SetStateAction<boolean>>];
type NavColorContextValue = [string, Dispatch<SetStateAction<string>>];

export const NavbarContext = createContext<NavOpenContextValue>([
  false,
  () => {},
]);

export const NavbarColorContext = createContext<NavColorContextValue>([
  "white",
  () => {},
]);

const NavContext = ({ children }: { children: ReactNode }) => {
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [navColor, setNavColor] = useState<string>("white");

  return (
    <NavbarContext.Provider value={[navOpen, setNavOpen]}>
      <NavbarColorContext.Provider value={[navColor, setNavColor]}>
        {children}
      </NavbarColorContext.Provider>
    </NavbarContext.Provider>
  );
};

export default NavContext;
