"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import {
  BRAND,
  SOCIAL_LINKS,
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
} from "../../../lib/contact";

gsap.registerPlugin(ScrollTrigger);

type SocialItem = {
  key: string;
  label: string;
  handle: string;
  href: string;
  icon: React.ReactNode;
};

const TikTokIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className="h-6 w-6"
  >
    <path d="M19.321 5.562a5.124 5.124 0 0 1-3.414-1.267 5.124 5.124 0 0 1-1.537-2.69V1.5h-3.171v13.627a2.86 2.86 0 1 1-2.014-2.734V9.15a6.046 6.046 0 1 0 5.185 5.981V8.688a8.294 8.294 0 0 0 4.951 1.61V7.127a5.104 5.104 0 0 1-.0-1.565z" />
  </svg>
);

// const InstagramIcon = () => (
//   <svg
//     viewBox="0 0 24 24"
//     fill="none"
//     stroke="currentColor"
//     strokeWidth="1.8"
//     strokeLinecap="round"
//     strokeLinejoin="round"
//     aria-hidden="true"
//     className="h-6 w-6"
//   >
//     <rect x="3" y="3" width="18" height="18" rx="5" />
//     <circle cx="12" cy="12" r="4" />
//     <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
//   </svg>
// );

const YoutubeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className="h-6 w-6"
  >
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const WhatsAppIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className="h-6 w-6"
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.889-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.304-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.463 3.488" />
  </svg>
);

const socials: SocialItem[] = [
  {
    key: "tiktok",
    label: "TikTok",
    handle: "@dayanapnl",
    href: SOCIAL_LINKS.tiktok,
    icon: <TikTokIcon />,
  },
  {
    key: "tiktok-2",
    label: "TikTok",
    handle: "@dayanapnl2",
    href: "https://www.tiktok.com/@dayanapnl2",
    icon: <TikTokIcon />,
  },
  // {
  //   key: "instagram",
  //   label: "Instagram",
  //   handle: "@dayanapnl",
  //   href: SOCIAL_LINKS.instagram,
  //   icon: <InstagramIcon />,
  // },
  {
    key: "youtube",
    label: "YouTube",
    handle: "@dayanapnl",
    href: SOCIAL_LINKS.youtube,
    icon: <YoutubeIcon />,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    handle: WHATSAPP_NUMBER,
    href: buildWhatsAppUrl(
      "Hola Dayana, vengo desde la web. Quiero conocer más sobre el proceso."
    ),
    icon: <WhatsAppIcon />,
  },
];

const quickLinks = [
  { label: "Testimonios", hash: "#testimonios" },
  { label: "Servicios", hash: "#servicios" },
  { label: "Contacto", hash: "#contacto" },
];

const Footer = () => {
  const rootRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const resolveHref = (hash: string) =>
    pathname === "/" ? hash : `/${hash}`;

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".fo-reveal").forEach((el, i) => {
        gsap.from(el, {
          y: 40,
          opacity: 0,
          duration: 0.9,
          delay: i * 0.08,
          ease: "power3.out",
          scrollTrigger: {
            trigger: el,
            start: "top 92%",
            once: true,
          },
        });
      });

      gsap.utils.toArray<HTMLElement>(".fo-social").forEach((el, i) => {
        gsap.from(el, {
          y: 20,
          opacity: 0,
          duration: 0.7,
          delay: 0.15 + i * 0.08,
          ease: "power2.out",
          scrollTrigger: {
            trigger: el,
            start: "top 95%",
            once: true,
          },
        });
      });
    },
    { scope: rootRef }
  );

  const year = new Date().getFullYear();
  const yearRange =
    BRAND.startedYear && year > BRAND.startedYear
      ? `${BRAND.startedYear}–${year}`
      : `${year}`;

  return (
    <footer
      ref={rootRef}
      id="redes"
      data-nav-color="white"
      className="relative z-10 bg-black text-white border-t border-linen/10 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          background: [
            "radial-gradient(50% 50% at 10% 0%, rgba(236,227,212,0.12), transparent 60%)",
            "radial-gradient(55% 45% at 90% 100%, rgba(237,195,177,0.14), transparent 65%)",
          ].join(","),
        }}
      />

      <div className="relative px-3 lg:px-8 pt-24 pb-10 max-w-[1600px] mx-auto">
        <div className="fo-reveal mb-16 lg:mb-24">
          <div className="font-[font2] uppercase leading-[0.95]">
            <div className="text-[11vw] lg:text-[7.5vw]">Vive la</div>
            <div className="text-[11vw] lg:text-[7.5vw] text-linen">
              transformación
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 mb-16">
          <div className="lg:col-span-5 fo-reveal">
            <div className="font-[font2] uppercase text-2xl lg:text-3xl tracking-[0.14em]">
              {BRAND.name}
            </div>
            <div className="font-[font1] text-sm uppercase tracking-[0.4em] opacity-60 mt-2">
              Maestra PNL
            </div>
            <p className="font-[font1] text-white/70 text-base lg:text-lg mt-6 max-w-md leading-snug">
              Reprogramación neurolingüística para reconectar con tu
              propósito, sanar patrones y recuperar el control de tu vida.
            </p>
          </div>

          <div className="lg:col-span-3 fo-reveal">
            <div className="font-[font2] uppercase text-xs tracking-[0.4em] opacity-60 mb-5">
              Navegación
            </div>
            <ul className="space-y-3">
              {quickLinks.map((l) => (
                <li key={l.hash}>
                  <a
                    href={resolveHref(l.hash)}
                    className="font-[font1] text-lg hover:text-linen transition-colors"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-4 fo-reveal">
            <div className="font-[font2] uppercase text-xs tracking-[0.4em] opacity-60 mb-5">
              Redes sociales
            </div>
            <ul className="grid grid-cols-2 gap-3">
              {socials.map((s) => (
                <li key={s.key} className="fo-social">
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${s.label} ${s.handle}`}
                    className="group flex items-center gap-3 rounded-xl border border-linen/15 bg-linen/[0.03] hover:border-linen/50 hover:bg-linen/[0.08] transition-colors px-4 py-3"
                  >
                    <span className="text-linen group-hover:text-white transition-colors">
                      {s.icon}
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="font-[font2] uppercase text-[10px] tracking-[0.3em] opacity-60">
                        {s.label}
                      </span>
                      <span className="font-[font1] text-sm truncate">
                        {s.handle}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="fo-reveal border-t border-linen/10 pt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="font-[font1] text-xs lg:text-sm text-white/55 leading-relaxed max-w-3xl">
            © {yearRange} {BRAND.shortName}. Todos los derechos reservados.
            Contenidos, marca y materiales del sitio protegidos por derechos de
            autor. Prohibida su reproducción total o parcial sin autorización.
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-[font1] uppercase tracking-[0.25em] text-white/50">
            <Link
              href="/aviso-privacidad"
              className="hover:text-linen transition-colors"
            >
              Aviso de privacidad
            </Link>
            <Link
              href="/terminos"
              className="hover:text-linen transition-colors"
            >
              Términos
            </Link>
            <Link
              href="/cookies"
              className="hover:text-linen transition-colors"
            >
              Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
