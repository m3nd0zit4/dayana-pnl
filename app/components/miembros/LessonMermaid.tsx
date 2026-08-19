"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";

/**
 * Diagramas de las lecciones, renderizados con Mermaid.
 *
 * Antes eran arte ASCII dentro de un bloque de código: flechas dibujadas con
 * caracteres, alineadas a ojo para un ancho concreto. Se veían mal en
 * escritorio y se rompían del todo en móvil.
 *
 * Mermaid entra por importación diferida porque pesa bastante y solo hace falta
 * en las lecciones que llevan diagrama; el resto del portal no lo carga.
 *
 * Los colores salen de las variables CSS del portal, leídas en el cliente: así
 * el diagrama sigue el tema claro/oscuro sin duplicar la paleta aquí. Por eso
 * el `classDef` se inyecta desde el componente y no se escribe en el markdown:
 * un `style N fill:#efe6d9` dentro del currículo quedaría fijado al tema claro.
 */

const cssVar = (name: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

/** Clases disponibles para el currículo: `Nodo["texto"]:::acento`. */
const classDefs = () =>
  [
    `classDef acento fill:${cssVar("--accent", "#edc3b1")},stroke:${cssVar("--primary", "#5c4a3a")},stroke-width:1.5px,color:${cssVar("--accent-foreground", "#141210")}`,
    `classDef atenuado fill:${cssVar("--muted", "#efe8dc")},stroke:${cssVar("--border", "#ddd")},color:${cssVar("--muted-foreground", "#6f655c")}`,
  ].join("\n");

const LessonMermaid = ({ chart }: { chart: string }) => {
  // Los colores se cocinan dentro del SVG en el momento del render, así que un
  // cambio de tema no los alcanza: hay que volver a generarlo.
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // `useId` trae dos puntos, que Mermaid usa como selector y rompe.
  const id = `mmd-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          // El render se dispara desde aquí, no al cargar la página: si no,
          // Mermaid busca diagramas en todo el documento y pisa el que ya
          // estaba pintado al cambiar de lección.
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: "inherit",
          flowchart: {
            // `basis` hacía que las aristas de retorno abrazaran los nodos y se
            // leyeran como si entraran donde no entran. `linear` las saca por un
            // lateral limpio.
            curve: "linear",
            htmlLabels: true,
            padding: 10,
            nodeSpacing: 44,
            rankSpacing: 46,
            useMaxWidth: true,
          },
          themeVariables: {
            background: "transparent",
            primaryColor: cssVar("--card", "#fff"),
            primaryTextColor: cssVar("--foreground", "#1a1a1a"),
            primaryBorderColor: cssVar("--border", "#ddd"),
            lineColor: cssVar("--muted-foreground", "#888"),
            secondaryColor: cssVar("--muted", "#f4f4f4"),
            tertiaryColor: cssVar("--muted", "#f4f4f4"),
            // Igual que el cuerpo de la lección. Mermaid escala el SVG al ancho
            // disponible, así que un tamaño pequeño aquí se encoge aún más.
            fontSize: "15px",
            // La etiqueta de una arista se pinta encima de la línea; sin fondo
            // propio queda ilegible cuando cruza otra flecha.
            edgeLabelBackground: cssVar("--card", "#fff"),
          },
        });

        const { svg: rendered } = await mermaid.render(
          id,
          `${chart.trim()}\n${classDefs()}`,
        );
        if (!cancelled) setSvg(rendered);
      } catch {
        // Un diagrama mal escrito no debe tumbar la lección entera.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  if (failed) {
    return (
      <p className="my-6 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Este diagrama no se pudo mostrar.
      </p>
    );
  }

  return (
    <div
      // `overflow-x-auto` para que un diagrama ancho haga scroll dentro de su
      // caja en vez de romper el ancho de la página. Los márgenes negativos le
      // roban a la columna de texto el ancho del `article` en pantallas
      // grandes: Mermaid escala el SVG al contenedor, así que cada píxel de
      // ancho es tipografía más legible.
      className="my-7 overflow-x-auto rounded-xl border border-border bg-card/60 px-4 py-6 lg:-mx-10 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // El SVG lo genera Mermaid en `securityLevel: "strict"`, que ya sanea las
      // etiquetas; el contenido viene del currículo del repo, no del usuario.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {svg ? undefined : (
        <p className="text-center text-sm text-muted-foreground">Cargando diagrama…</p>
      )}
    </div>
  );
};

export default LessonMermaid;
