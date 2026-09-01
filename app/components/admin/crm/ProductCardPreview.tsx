"use client";

import { useState } from "react";

import PublicProductCard from "@/app/components/productos/PublicProductCard";
import CrmSegmentedControl from "./CrmSegmentedControl";
import type { Plan, PlanKind } from "@/lib/plans";

/**
 * La tarjeta pública, tal cual, dentro del panel.
 *
 * Renderiza **el mismo `PublicProductCard`** que la web, no una imitación. Esa
 * es toda la idea: una previsualización dibujada aparte se desincroniza en el
 * primer cambio de estilo y a partir de ahí miente justo cuando más se confía
 * en ella, al publicar.
 *
 * Va envuelta en un contenedor con el fondo de la web (`bg-hero-paper`) y no
 * con el del CRM: una tarjeta pensada para papel crema se lee distinta sobre
 * el gris del panel, y la pregunta que responde esta pantalla es "¿cómo se ve
 * publicada?".
 */

export type ProductPreviewInput = {
  kind: string;
  title: string;
  sessionsLabel: string;
  sessionsCount: string;
  description: string;
  imageUrl: string;
  tag: string;
  highlight: boolean;
  unitPriceLabel: string;
  amountUsd: string;
  listAmountUsd: string;
  amountCop: string;
  listAmountCop: string;
};

const toNumber = (value: string): number | undefined => {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Del formulario al `Plan` que consume la tarjeta.
 *
 * Es el mismo mapeo que hace `productToPlan` al leer de la base —
 * `description` partido por saltos de línea en viñetas, `unitPriceLabel` a
 * `unitPrice`— pero sobre lo que hay escrito ahora mismo, sin guardar. Si los
 * dos mapeos se separaran, la vista previa volvería a mentir; por eso el
 * único trozo que se duplica es este, y es de tres líneas.
 */
export const previewToPlan = (input: ProductPreviewInput): Plan => ({
  id: "preview",
  kind: (input.kind === "THERAPY" ? "therapy" : "course") as PlanKind,
  title: input.title.trim() || "Sin título",
  sessions: input.sessionsLabel.trim() || input.title.trim() || "—",
  sessionsCount: toNumber(input.sessionsCount),
  amountUsd: toNumber(input.amountUsd) ?? 0,
  listAmountUsd: toNumber(input.listAmountUsd),
  amountCop: toNumber(input.amountCop),
  listAmountCop: toNumber(input.listAmountCop),
  imageUrl: input.imageUrl.trim() || undefined,
  unitPrice: input.unitPriceLabel.trim() || undefined,
  tag: input.tag.trim() || undefined,
  highlight: input.highlight,
  features: input.description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
  whatsappMessage: "",
});

const ProductCardPreview = ({ input }: { input: ProductPreviewInput }) => {
  // La misma tarjeta se ve distinta según la región: Colombia lee COP y el
  // resto USD. Poder alternar es lo que evita publicar un producto sin precio
  // en una de las dos y no enterarse.
  const [region, setRegion] = useState<"co" | "intl">("co");
  const isColombia = region === "co";
  const plan = previewToPlan(input);

  const missingPrice = isColombia
    ? plan.amountCop == null || plan.amountCop <= 0
    : plan.amountUsd <= 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Así se publica
        </p>
        <CrmSegmentedControl
          segments={[
            { id: "co" as const, label: "Colombia" },
            { id: "intl" as const, label: "Resto" },
          ]}
          value={region}
          onChange={setRegion}
          aria-label="Región de la vista previa"
        />
      </div>

      {missingPrice && (
        <p className="text-sm text-destructive" role="alert">
          Sin precio en {isColombia ? "COP" : "USD"}, esta tarjeta **no se
          muestra** a esa región: el botón de pago fallaría en el checkout.
        </p>
      )}

      <div className="rounded-2xl border border-border bg-hero-paper p-5">
        <PublicProductCard plan={plan} isColombia={isColombia} size="sm" />
      </div>

      <p className="text-xs text-muted-foreground">
        Es el mismo componente que la web, no una imitación: lo que ves aquí es
        lo que se publica.
      </p>
    </div>
  );
};

export default ProductCardPreview;
