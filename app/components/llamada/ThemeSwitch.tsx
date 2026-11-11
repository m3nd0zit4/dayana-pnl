"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Claro / oscuro en la página de venta. Arranca con el tema del sistema de la
 * persona (dueño, 11-nov: «que tome por defecto el tema del sistema») y este
 * botón lo cambia; la elección queda en el navegador.
 *
 * `resolvedTheme` es `undefined` hasta que next-themes resuelve el tema en el
 * navegador: el primer render del cliente coincide así con el del servidor, y
 * los dos iconos se muestran con CSS (`dark:`), sin depender de ese valor.
 */
const ThemeSwitch = ({ className = "" }: { className?: string }) => {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      // Etiqueta fija: el tema solo se sabe en el navegador, y una etiqueta que
      // dependa de él no coincidiría con el HTML del servidor.
      aria-label="Cambiar entre tema claro y oscuro"
      title="Tema claro / oscuro"
      className={`inline-flex size-11 items-center justify-center rounded-full border border-foreground/15 text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      <Sun className="hidden size-[18px] dark:block" aria-hidden="true" />
      <Moon className="size-[18px] dark:hidden" aria-hidden="true" />
    </button>
  );
};

export default ThemeSwitch;
