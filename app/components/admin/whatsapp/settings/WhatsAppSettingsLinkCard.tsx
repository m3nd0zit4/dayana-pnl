import { ArrowRight, MessageCircle } from "lucide-react";
import Link from "next/link";

/**
 * Enlace compacto desde Ajustes → Canales: WhatsApp (conexión, IA, saludo,
 * citas) se configura en un solo sitio, su propia sección.
 */
const WhatsAppSettingsLinkCard = () => (
  <Link
    href="/admin/whatsapp/ajustes?tab=conexion"
    className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-[#00a884]/60"
  >
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#00a884]/10 text-[#008069] dark:text-[#00a884]">
      <MessageCircle className="size-4" aria-hidden />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium">WhatsApp se configura en WhatsApp → Ajustes</span>
      <span className="block text-xs text-muted-foreground">Conexión, IA, citas, saludo y avisos, todo en un lugar.</span>
    </span>
    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
  </Link>
);

export default WhatsAppSettingsLinkCard;
