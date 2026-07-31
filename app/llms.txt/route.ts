import { getPublicPlans } from "@/lib/plans-from-db";
import { formatUsd, formatCop } from "@/lib/plans";
import { BRAND, WHATSAPP_NUMBER, SOCIAL_LINKS } from "@/lib/contact";
import { getSiteUrl } from "@/lib/site-url";

export const revalidate = 3600;

export async function GET() {
  const siteUrl = getSiteUrl();
  const { therapyPlans, coursePlan } = await getPublicPlans();

  const usdValues = therapyPlans.map((p) => p.amountUsd);
  const copValues = therapyPlans
    .map((p) => p.amountCop)
    .filter((v): v is number => v != null);
  const fromUsd = usdValues.length > 0 ? Math.min(...usdValues) : null;
  const fromCop = copValues.length > 0 ? Math.min(...copValues) : null;

  const lines = [
    `# ${BRAND.shortName}`,
    "",
    `> ${BRAND.tagline}. Sesiones de reprogramación neurolingüística 1:1 en vivo por Google Meet y talleres virtuales.`,
    "",
    "## Servicios",
    "",
    `- Terapias 1:1 por Google Meet, paquetes de 1 a 24 sesiones${fromUsd != null ? ` — desde ${formatUsd(fromUsd)}${fromCop != null ? ` / ${formatCop(fromCop)}` : ""}` : ""}: ${siteUrl}/servicios`,
    `- Talleres virtuales en vivo: ${siteUrl}/taller-virtual`,
    ...(coursePlan
      ? [`- Curso en vivo — ${formatUsd(coursePlan.amountUsd)}${coursePlan.amountCop != null ? ` / ${formatCop(coursePlan.amountCop)}` : ""}: ${siteUrl}/servicios`]
      : []),
    "",
    "## Contacto",
    "",
    `- WhatsApp: ${WHATSAPP_NUMBER}`,
    `- Email: ${SOCIAL_LINKS.email.replace(/^mailto:/, "")}`,
    `- Instagram: ${SOCIAL_LINKS.instagram}`,
    `- TikTok: ${SOCIAL_LINKS.tiktok}`,
    `- YouTube: ${SOCIAL_LINKS.youtube}`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
