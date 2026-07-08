import Link from "next/link";

type Props = {
  href?: string;
};

/** Mismo wordmark que el navbar de la landing (solo texto). */
const CrmLogo = ({ href = "/admin" }: Props) => (
  <Link
    href={href}
    prefetch={false}
    className="block px-2 py-1 font-[font2] text-foreground uppercase leading-none transition-opacity select-none hover:opacity-80"
    aria-label="CRM Dayana Beltrán PNL"
  >
    <span className="block text-sm tracking-[0.14em] lg:text-base">
      Dayana Beltr&aacute;n
    </span>
    <span className="mt-1.5 block text-[10px] tracking-[0.5em] opacity-70 lg:text-xs">
      PNL
    </span>
  </Link>
);

export default CrmLogo;
