import Link from "next/link";
import { Sparkles, Star, Users, LogIn, ArrowUpRight } from "lucide-react";
import {
  BRAND,
  SOCIAL_LINKS,
  WHATSAPP_NUMBER,
  WHATSAPP_COMMUNITY_URL,
  buildWhatsAppUrl,
} from "@/lib/contact";

const TikTokIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
    <path d="M19.321 5.562a5.124 5.124 0 0 1-3.414-1.267 5.124 5.124 0 0 1-1.537-2.69V1.5h-3.171v13.627a2.86 2.86 0 1 1-2.014-2.734V9.15a6.046 6.046 0 1 0 5.185 5.981V8.688a8.294 8.294 0 0 0 4.951 1.61V7.127a5.104 5.104 0 0 1-.0-1.565z" />
  </svg>
);

const InstagramIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-5 w-5"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
  </svg>
);

const YoutubeIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-6 w-6">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.889-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.304-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.463 3.488" />
  </svg>
);

type LinkRow = {
  key: string;
  label: string;
  sublabel?: string;
  href: string;
  icon: React.ReactNode;
  internal?: boolean;
};

const INTERNAL_LINKS: LinkRow[] = [
  {
    key: "servicios",
    label: "Servicios y precios",
    sublabel: "Terapias 1:1 y curso en vivo",
    href: "/servicios",
    icon: <Sparkles className="h-5 w-5" />,
    internal: true,
  },
  {
    key: "talleres",
    label: "Talleres en vivo",
    sublabel: "Próximas ediciones y cupos",
    href: "/taller-virtual",
    icon: <Users className="h-5 w-5" />,
    internal: true,
  },
  {
    key: "miembros",
    label: "Portal de miembros",
    sublabel: "Entra a tus clases y grabaciones",
    href: "/miembros",
    icon: <LogIn className="h-5 w-5" />,
    internal: true,
  },
];

const TESTIMONIALS_LINK: LinkRow = {
  key: "testimonios",
  label: "Testimonios",
  sublabel: "Lo que dicen quienes ya vivieron el proceso",
  href: "/",
  icon: <Star className="h-5 w-5" />,
  internal: true,
};

const SOCIAL_LINKS_LIST: LinkRow[] = [
  {
    key: "instagram",
    label: "Instagram",
    sublabel: "@dayana.pnl",
    href: SOCIAL_LINKS.instagram,
    icon: <InstagramIcon />,
  },
  {
    key: "tiktok",
    label: "TikTok",
    sublabel: "@dayanapnl",
    href: SOCIAL_LINKS.tiktok,
    icon: <TikTokIcon />,
  },
  {
    key: "youtube",
    label: "YouTube",
    sublabel: "@dayanabeltranpnl",
    href: SOCIAL_LINKS.youtube,
    icon: <YoutubeIcon />,
  },
];

const Row = ({ row, delay }: { row: LinkRow; delay: number }) => {
  const content = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linen/10 text-linen ring-1 ring-inset ring-white/5 transition-colors duration-200 group-hover:bg-terracotta/20 group-hover:text-blush">
        {row.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-[font1] text-base text-white">
          {row.label}
        </span>
        {row.sublabel && (
          <span className="block truncate font-[font1] text-xs text-white/60">
            {row.sublabel}
          </span>
        )}
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-white/35 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-terracotta" />
    </>
  );

  const className =
    "lt-fade lt-row group flex w-full items-center gap-3.5 rounded-2xl border border-white/15 bg-black/25 px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-terracotta/45 hover:bg-black/35 active:translate-y-0 active:scale-[0.99]";

  const style = { animationDelay: `${delay}ms` };

  if (row.internal) {
    return (
      <Link href={row.href} className={className} style={style}>
        {content}
      </Link>
    );
  }

  return (
    <a
      href={row.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
    >
      {content}
    </a>
  );
};

type CtaVariant = "solid" | "outline";

const Cta = ({
  href,
  icon,
  title,
  subtitle,
  badge,
  variant,
  delay,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: string;
  variant: CtaVariant;
  delay: number;
}) => {
  const variantClass =
    variant === "solid"
      ? "bg-gradient-to-br from-[#2fdb70] to-[#0f9d58] shadow-[0_10px_28px_-10px_rgba(37,211,102,0.6)] hover:shadow-[0_14px_32px_-8px_rgba(37,211,102,0.7)]"
      : "border border-[#3fdc7a]/40 bg-[#25D366]/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-[#3fdc7a]/60 hover:bg-[#25D366]/[0.14]";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`lt-fade group relative flex w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${variantClass}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${
          variant === "solid" ? "bg-white/15 ring-1 ring-white/25" : "bg-[#25D366]/20 ring-1 ring-[#3fdc7a]/30"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="font-[font2] text-sm uppercase tracking-wide text-white">
            {title}
          </span>
          {badge && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 font-[font2] text-[9px] uppercase tracking-wider text-white">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate font-[font1] text-xs text-white/70">
          {subtitle}
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-white/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </a>
  );
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-3 flex items-center gap-3">
    <span className="font-[font2] text-[10px] uppercase tracking-[0.4em] text-white/50">
      {children}
    </span>
    <span className="h-px flex-1 bg-gradient-to-r from-linen/25 to-transparent" />
  </div>
);

const LinktreePage = () => {
  const whatsappHref = buildWhatsAppUrl(
    "Hola Dayana, te escribo desde tu página de enlaces."
  );

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#59493a] text-white">
      {/* Banner sized to the photo's own aspect ratio — shown close to native
          resolution instead of stretched to cover the whole viewport height
          (which upscaled it 2-3x on tall phone screens and blurred it).
          Fades into the flat page color below rather than needing a heavy
          dark wash over everything. */}
      <div className="relative h-[34vh] max-h-[300px] w-full overflow-hidden">
        <picture>
          <source srcSet="/dayana-photos/opt/enlaces-bg-1181.avif" type="image/avif" />
          <source srcSet="/dayana-photos/opt/enlaces-bg-1181.webp" type="image/webp" />
          <img
            src="/dayana-photos/opt/enlaces-bg-1181.webp"
            alt=""
            aria-hidden="true"
            className="pointer-events-none h-full w-full object-cover object-center"
          />
        </picture>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: [
              "linear-gradient(to bottom, rgba(20,15,10,0.1), rgba(20,15,10,0.05) 55%, #59493a 96%)",
            ].join(","),
          }}
        />
      </div>

      <div className="relative mx-auto -mt-14 flex w-full max-w-sm flex-col items-center px-4 pb-[max(3rem,env(safe-area-inset-bottom))]">
        <div className="lt-fade relative">
          <span
            aria-hidden="true"
            className="lt-glow absolute -inset-3 rounded-full bg-[radial-gradient(circle,rgba(192,101,74,0.45),rgba(237,195,177,0.15)_55%,transparent_75%)] blur-lg"
          />
          <picture>
            <source srcSet="/dayana-photos/opt/IMG_4005-600.avif" type="image/avif" />
            <source srcSet="/dayana-photos/opt/IMG_4005-600.webp" type="image/webp" />
            <img
              src="/dayana-photos/opt/IMG_4005-600.webp"
              alt={BRAND.name}
              width={104}
              height={104}
              className="relative h-[104px] w-[104px] rounded-full object-cover ring-4 ring-[#59493a]"
            />
          </picture>
        </div>

        <h1 className="lt-fade mt-4 font-[font2] uppercase text-xl tracking-[0.14em] text-white" style={{ animationDelay: "60ms" }}>
          {BRAND.name}
        </h1>

        <div className="mt-7 flex w-full flex-col gap-3">
          <Cta
            href={whatsappHref}
            icon={<WhatsAppIcon />}
            title="Escríbeme por WhatsApp"
            subtitle={WHATSAPP_NUMBER}
            variant="solid"
            delay={140}
          />
          <Cta
            href={WHATSAPP_COMMUNITY_URL}
            icon={<Users className="h-5 w-5" />}
            title="Comunidad de WhatsApp"
            subtitle="Únete y acompaña el proceso con otras personas"
            badge="Gratis"
            variant="outline"
            delay={180}
          />
        </div>

        <div className="mt-9 w-full">
          <Row row={TESTIMONIALS_LINK} delay={200} />
        </div>

        <div className="mt-8 w-full">
          <SectionLabel>Sígueme</SectionLabel>
          <div className="flex flex-col gap-3">
            {SOCIAL_LINKS_LIST.map((row, i) => (
              <Row key={row.key} row={row} delay={260 + i * 60} />
            ))}
          </div>
        </div>

        <div className="mt-8 w-full">
          <SectionLabel>Explora</SectionLabel>
          <div className="flex flex-col gap-3">
            {INTERNAL_LINKS.map((row, i) => (
              <Row key={row.key} row={row} delay={440 + i * 60} />
            ))}
          </div>
        </div>

        <p className="lt-fade mt-10 pb-4 font-[font1] text-[11px] text-white/40" style={{ animationDelay: "700ms" }}>
          © {new Date().getFullYear()} {BRAND.shortName}
        </p>
      </div>

      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .lt-fade {
            opacity: 0;
            animation: lt-fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .lt-glow {
            animation: lt-pulse 3.6s ease-in-out infinite;
          }
        }
        @keyframes lt-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes lt-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
      `}</style>
    </main>
  );
};

export default LinktreePage;
