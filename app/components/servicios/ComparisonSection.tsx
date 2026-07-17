import {
  formatCop,
  formatUsd,
  getTherapySavingsUsd,
  type Plan,
  type PlanId,
} from "../../../lib/plans";

type Props = {
  therapyPlans: Plan[];
  isColombia: boolean;
};

/** Datos que no viven en la DB — ritmo y duración estimada por paquete. */
const COMPARISON_STATIC: Partial<
  Record<PlanId, { ritmo: string; duracion: string }>
> = {
  "therapy-1": { ritmo: "Sesión única", duracion: "1 día" },
  "therapy-3": { ritmo: "2 sesiones sem. 1 · 1 sem. 2", duracion: "1 semana y media" },
  "therapy-6": { ritmo: "2 por semana · 3 semanas", duracion: "3 semanas" },
  "therapy-12": { ritmo: "2 por semana · 6 semanas", duracion: "1 mes y medio" },
  "therapy-24": { ritmo: "2 por semana · 12 semanas", duracion: "2 meses y medio" },
};

const ComparisonSection = ({ therapyPlans, isColombia }: Props) => {
  if (therapyPlans.length === 0) return null;

  const price = (p: Plan) =>
    isColombia && p.amountCop != null
      ? `${formatCop(p.amountCop)} COP`
      : `${formatUsd(p.amountUsd)} USD`;

  const perSession = (p: Plan) => {
    const count = p.sessionsCount ?? 0;
    if (count <= 1) return "—";
    return isColombia && p.amountCop != null
      ? `≈ ${formatCop(p.amountCop / count)} COP`
      : `≈ ${formatUsd(p.amountUsd / count)} USD`;
  };

  const savings = (p: Plan) => {
    if (isColombia && p.listAmountCop != null && p.amountCop != null) {
      const s = p.listAmountCop - p.amountCop;
      return s > 0 ? `${formatCop(s)} COP` : "—";
    }
    const s = getTherapySavingsUsd(p);
    return s != null ? `${formatUsd(s)} USD` : "—";
  };

  const rows: { label: string; value: (p: Plan) => string }[] = [
    { label: "Nº de sesiones", value: (p) => String(p.sessionsCount ?? "—") },
    { label: "Precio total", value: price },
    { label: "Precio por sesión", value: perSession },
    { label: "Ahorro vs. valor real", value: savings },
    { label: "Duración por sesión", value: () => "1 hora" },
    { label: "Modalidad", value: () => "1:1 en vivo · Google Meet" },
    {
      label: "Ritmo sugerido",
      value: (p) => COMPARISON_STATIC[p.id]?.ritmo ?? "—",
    },
    {
      label: "Duración estimada",
      value: (p) => COMPARISON_STATIC[p.id]?.duracion ?? "—",
    },
    { label: "Reprogramaciones", value: () => "1–2 por sesión" },
  ];

  return (
    <section data-nav-color="black" className="bg-[#faf7f2] text-black border-t border-black/10">
      <div className="px-3 lg:px-8 py-16 lg:py-24">
        <h2 className="font-[font2] text-4xl lg:text-[4.5vw] uppercase leading-[0.9] mb-3">
          ¿Qué incluye cada paquete?
        </h2>
        <p className="font-[font1] text-base lg:text-lg text-black/70 mb-10 max-w-xl">
          Mismo acompañamiento en todos los paquetes; cambia la profundidad del
          proceso y el precio por sesión.
        </p>

        <div className="overflow-x-auto rounded-2xl border border-black/15">
          <table className="w-full min-w-[720px] text-left border-collapse">
            <thead>
              <tr className="border-b border-black/15">
                <th className="sticky left-0 bg-[#faf7f2] p-4 font-mono text-[10px] uppercase tracking-[0.25em] text-black/45 font-normal align-bottom">
                  Paquete
                </th>
                {therapyPlans.map((p) => (
                  <th
                    key={p.id}
                    className={`p-4 align-bottom ${
                      p.highlight ? "bg-linen/50" : ""
                    }`}
                  >
                    <div className="font-[font2] text-3xl leading-none">
                      {p.sessionsCount ?? "—"}
                    </div>
                    <div className="font-[font2] uppercase text-[11px] tracking-[0.15em] mt-1.5">
                      {p.title}
                    </div>
                    {p.tag && (
                      <span className="mt-1.5 inline-block font-[font2] uppercase text-[9px] tracking-wider bg-blush text-black px-2 py-0.5 rounded-full">
                        {p.tag}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-black/[0.07] last:border-b-0">
                  <td className="sticky left-0 bg-[#faf7f2] p-4 font-[font1] text-[13px] text-black/60 whitespace-nowrap">
                    {row.label}
                  </td>
                  {therapyPlans.map((p) => (
                    <td
                      key={p.id}
                      className={`p-4 font-[font1] text-[13.5px] ${
                        p.highlight ? "bg-linen/50 font-medium" : ""
                      }`}
                    >
                      {row.value(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

export default ComparisonSection;
