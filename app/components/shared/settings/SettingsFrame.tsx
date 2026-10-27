"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Marco de las páginas de ajustes: menú lateral + contenido.
 *
 * En `/admin/ajustes` a secas el contenido es el índice, que ya muestra todos
 * los grupos: un menú al lado repetiría exactamente lo mismo, así que ahí el
 * contenido va a ancho completo. En cualquier página de ajustes concreta el
 * menú lateral vuelve, para saltar de una a otra sin pasar por el índice.
 */
const SettingsFrame = ({ nav, children }: { nav: ReactNode; children: ReactNode }) => {
  const pathname = usePathname();

  if (pathname === "/admin/ajustes") {
    return <div className="min-w-0 space-y-6">{children}</div>;
  }

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <div className="flex shrink-0 flex-col gap-5 sm:w-52">{nav}</div>
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </div>
  );
};

export default SettingsFrame;
