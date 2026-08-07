"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "next-themes"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * El comentario que había aquí decía que la aplicación no tiene modo oscuro y
 * fijaba `theme="light"`. Es falso: `app/providers.tsx` monta `ThemeProvider`
 * para `/admin` y para `/miembros`, y hay un interruptor de tema en ajustes.
 * El resultado era que todo se volvía oscuro menos los avisos.
 *
 * El fallback importa: `providers.tsx` monta también un `<Toaster/>` dentro de
 * `MarketingChrome`, donde **no** hay `ThemeProvider`, así que ahí
 * `resolvedTheme` es `undefined` y el sitio público se queda en claro, que es
 * lo correcto.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={(resolvedTheme as ToasterProps["theme"]) ?? "light"}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
