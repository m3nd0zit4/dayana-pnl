import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { relatedSettingsLinks } from "@/app/config/settings-nav";

/**
 * Pie «Relacionado» del centro de ajustes.
 *
 * No mueve nada: son páginas operativas que siguen en el menú principal porque
 * se usan a diario. Están aquí solo para que quien abra Ajustes vea de un
 * vistazo todo lo que se puede configurar, aunque no todo viva bajo esta ruta.
 */
const SettingsRelatedLinks = () => (
  <section className="border-t pt-4">
    <p className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      Relacionado
    </p>
    <ul className="mt-2 flex flex-col gap-0.5">
      {relatedSettingsLinks.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{link.label}</span>
              <span className="block truncate text-xs opacity-80">
                {link.description}
              </span>
            </span>
            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 opacity-60" />
          </Link>
        </li>
      ))}
    </ul>
  </section>
);

export default SettingsRelatedLinks;
