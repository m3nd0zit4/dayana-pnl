import Link from "next/link";
import { BRAND } from "@/lib/contact";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

const AdminNotFound = () => (
  <div
    className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
    style={{
      background:
        "radial-gradient(60% 50% at 50% 0%, rgba(237,195,177,0.35), transparent), var(--background)",
    }}
  >
    <Card className="w-full max-w-md text-center">
      <CardContent className="space-y-6">
        <p className="text-[10px] tracking-[0.45em] text-muted-foreground" aria-hidden>
          404
        </p>
        <div className="uppercase leading-none">
          <span className="block text-base tracking-[0.14em]">{BRAND.name}</span>
          <span className="mt-1.5 block text-[10px] tracking-[0.5em] opacity-70">
            PNL
          </span>
        </div>
        <h1 className="text-lg font-semibold">Ruta no encontrada</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Esta sección del panel no existe o fue movida. Vuelve al inicio del CRM
          o inicia sesión de nuevo si tu sesión expiró.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button nativeButton={false} render={<Link href="/admin" />}>Ir al panel</Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/acceso" />}>
            Iniciar sesión
          </Button>
        </div>
        <Link
          href="/"
          className="inline-block text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          ← Volver a {BRAND.shortName.toLowerCase()}
        </Link>
      </CardContent>
    </Card>
  </div>
);

export default AdminNotFound;
