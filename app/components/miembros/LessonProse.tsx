import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import LessonMermaid from "./LessonMermaid";

/**
 * Tipografía de lectura del portal.
 *
 * Las lecciones se renderizaban con cuatro utilidades sueltas (`[&_h2]:font-bold`
 * y poco más), así que un texto largo salía como un bloque gris sin jerarquía ni
 * respiración. Aquí vive el único estilo de lectura del curso: medida de línea
 * acotada, escala de encabezados, y tablas y citas que no se salen del ancho.
 *
 * La medida (~68 caracteres) no es decorativa: por encima de eso el ojo pierde
 * el renglón al saltar de línea.
 */
const LessonProse = ({
  children,
  className,
}: {
  children: string;
  className?: string;
}) => (
  <div
    className={cn(
      "max-w-[68ch] text-[15px] leading-[1.75] text-foreground/90",
      // Encabezados: escala clara y aire por encima, que es lo que separa
      // visualmente una sección de la anterior.
      "[&_h1]:mt-0 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-foreground",
      "[&_h2]:mt-9 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground",
      "[&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground",
      "[&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0",
      // Párrafos y listas
      "[&_p]:my-4",
      "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-5",
      "[&_li]:my-1.5 [&_li]:pl-1",
      "[&_li>ul]:my-2 [&_li>ol]:my-2",
      // Énfasis
      "[&_strong]:font-semibold [&_strong]:text-foreground",
      "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:no-underline",
      // Cita: el recurso que más usan estas lecciones para las frases de cierre
      "[&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-foreground [&_blockquote]:italic",
      "[&_blockquote_p]:my-2",
      // Separador
      "[&_hr]:my-8 [&_hr]:border-border",
      // Tablas: scroll propio para no romper el ancho de la página
      "[&_table]:my-6 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-sm",
      "[&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:whitespace-nowrap",
      "[&_td]:border-b [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top",
      // Código / diagramas ASCII
      "[&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-relaxed",
      "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px]",
      "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
      className
    )}
  >
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Un bloque cercado de tipo mermaid se dibuja como diagrama real en
        // vez de imprimirse como arte ASCII — ver LessonMermaid.
        pre: ({ children, ...rest }) => {
          const child = Array.isArray(children) ? children[0] : children;
          const props = (child as { props?: { className?: string; children?: unknown } })
            ?.props;
          const kind = /language-(\w+)/.exec(props?.className ?? "")?.[1];

          if (kind === "mermaid") {
            return <LessonMermaid chart={String(props?.children ?? "").trim()} />;
          }
          return <pre {...rest}>{children}</pre>;
        },
        // Las referencias apuntan fuera del portal: abrirlas en la misma
        // pestaña sacaba al alumno de la lección que estaba leyendo.
        a: ({ href, children: linkChildren, ...rest }) => {
          const external = /^https?:\/\//.test(href ?? "");
          return (
            <a
              href={href}
              {...(external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              {...rest}
            >
              {linkChildren}
            </a>
          );
        },
      }}
    >
      {children}
    </Markdown>
  </div>
);

/** ~200 palabras por minuto, redondeado hacia arriba y con mínimo de 1. */
export const readingMinutes = (markdown: string | null | undefined): number => {
  if (!markdown?.trim()) return 1;
  return Math.max(1, Math.round(markdown.trim().split(/\s+/).length / 200));
};

export default LessonProse;
