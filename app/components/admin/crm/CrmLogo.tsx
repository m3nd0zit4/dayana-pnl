import Link from "next/link";

type Props = {
  href?: string;
};

/** Text-only wordmark for the top bar row — no icon (the AI ghost mark is a separate identity, kept only on the assistant toggle/panel, not paired with the brand logo). */
const CrmLogo = ({ href = "/admin" }: Props) => (
  <Link
    href={href}
    prefetch={false}
    className="block shrink-0 px-1 font-[font2] whitespace-nowrap text-[var(--crm-topbar-foreground)] uppercase leading-none transition-opacity select-none hover:opacity-80"
    aria-label="CRM Dayana Beltrán PNL"
  >
    <span className="text-sm tracking-[0.14em] lg:text-base">Dayana Beltr&aacute;n</span>
    <span className="ml-1.5 hidden text-[10px] tracking-[0.3em] opacity-60 sm:inline">PNL</span>
  </Link>
);

export default CrmLogo;
