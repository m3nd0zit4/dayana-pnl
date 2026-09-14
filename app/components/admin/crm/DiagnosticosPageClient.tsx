"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Compass, User } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/app/components/ui/badge";
import { PROFILE_SHORT_LABEL } from "@/lib/diagnostico/profiles";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmSegmentedControl from "./CrmSegmentedControl";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmFilterBar,
  CrmRowAction,
  CrmRowActions,
  CrmSearchInput,
} from "./ui";

export type DiagnosticoRow = {
  id: string;
  token: string;
  profile:
    | "EXPLORADOR"
    | "EN_PROCESO"
    | "RAIZ_PROFUNDA"
    | "EN_EXPANSION"
    | null;
  urgencyScore: number | null;
  commitmentScore: number | null;
  /** Título del producto recomendado, ya resuelto — nunca el slug. */
  recommendedProductTitle: string | null;
  source: string | null;
  /** `source` ya traducido — "enlaces" → "Página de enlaces", etc. */
  sourceLabel: string | null;
  completedAt: string | null;
  hasPurchased: boolean;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phoneE164: string;
  } | null;
  /** Qué contestó sobre cuándo empezar, ya traducido. */
  objection: string | null;
  /** Emocional o crecimiento. Null en diagnósticos de antes del rediseño. */
  track: "emocional" | "crecimiento" | null;
};

const TRACK_LABEL: Record<NonNullable<DiagnosticoRow["track"]>, string> = {
  emocional: "Emocional",
  crecimiento: "Crecimiento",
};

type Segment = "todos" | "calientes" | "sin-comprar";

const SEGMENTS = [
  { id: "calientes" as const, label: "Listos para hablar" },
  { id: "sin-comprar" as const, label: "Sin comprar" },
  { id: "todos" as const, label: "Todos" },
];

/** A partir de aquí la persona dijo que puede invertir y sabe por qué Dayana. */
const HOT_COMMITMENT = 6;

type Props = {
  preview: boolean;
  diagnosticos: DiagnosticoRow[];
};

/**
 * La bandeja que sustituye a la llamada de calificación.
 *
 * Ordena por compromiso y no por fecha a propósito: la pregunta que resuelve
 * esta pantalla no es "¿quién entró último?" sino "¿a quién llamo hoy?". El
 * orden lo pone la consulta (`listCompletedDiagnostics`), en SQL.
 *
 * Cada fila lleva al detalle (`/admin/diagnosticos/[id]`), donde se ven todas
 * las respuestas — antes esta lista era el único sitio donde vivían y no
 * había forma de leerlas.
 */
const DiagnosticosPageClient = ({ preview, diagnosticos }: Props) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSegment = searchParams.get("segmento");
  const [segment, setSegment] = useState<Segment>(
    urlSegment === "sin-comprar" || urlSegment === "todos" || urlSegment === "calientes"
      ? urlSegment
      : "calientes"
  );
  /*
    `?recientes=14` es a donde lleva «Para hoy»: diagnósticos terminados en esos
    días, con persona y sin compra. La pestaña «Sin comprar» sola cuenta todo
    el histórico, y por eso el número de la portada no se encontraba aquí.
  */
  const recentParam = Number(searchParams.get("recientes"));
  // «Ahora» se fija una vez por montaje: leer el reloj durante el render daría
  // un resultado distinto en cada render, y React lo prohíbe.
  const [nowMs] = useState(() => Date.now());
  const [recentDays, setRecentDays] = useState<number | null>(
    Number.isInteger(recentParam) && recentParam > 0 ? recentParam : null
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return diagnosticos.filter((d) => {
      if (segment === "calientes") {
        if ((d.commitmentScore ?? 0) < HOT_COMMITMENT || d.hasPurchased) {
          return false;
        }
      }
      if (segment === "sin-comprar" && d.hasPurchased) return false;
      if (recentDays !== null) {
        if (!d.contact || !d.completedAt) return false;
        if (nowMs - new Date(d.completedAt).getTime() > recentDays * 86_400_000) {
          return false;
        }
      }
      if (!q) return true;
      return [
        d.contact?.name,
        d.contact?.email,
        d.contact?.phoneE164,
        d.objection,
        d.sourceLabel,
        d.track ? TRACK_LABEL[d.track] : null,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [diagnosticos, segment, query, recentDays, nowMs]);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Diagnósticos"
        description="Quién respondió el cuestionario, qué necesita y cuándo quiere empezar. Ordenados por lo cerca que están de decidirse, no por fecha. Abre uno para ver todas sus respuestas."
        trailing={
          <CrmSegmentedControl
            segments={SEGMENTS}
            value={segment}
            onChange={setSegment}
            aria-label="Filtrar diagnósticos"
          />
        }
      />

      {recentDays !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm">
          <span>
            Últimos {recentDays} días, con persona identificada: {filtered.length}
          </span>
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setRecentDays(null)}
          >
            Ver todos
          </button>
        </div>
      )}

      <CrmFilterBar count={`${filtered.length} de ${diagnosticos.length}`}>
        <CrmSearchInput
          value={query}
          onChange={setQuery}
          placeholder="Buscar por nombre, correo o respuesta…"
        />
      </CrmFilterBar>

      {filtered.length === 0 ? (
        <CrmEmptyState
          icon={Compass}
          title={
            preview
              ? "Sin datos en vista previa"
              : diagnosticos.length === 0
                ? "Todavía nadie ha completado el cuestionario"
                : "Nadie encaja con este filtro"
          }
          description={
            diagnosticos.length === 0
              ? "Cuando alguien termine el cuestionario de /terapias/empezar aparecerá aquí, con sus respuestas y su nivel de compromiso."
              : "Prueba con otro segmento o limpia la búsqueda."
          }
        />
      ) : (
        <CrmDataList>
          {filtered.map((d) => (
            <CrmDataListRow
              key={d.id}
              // `relative` para el enlace estirado del nombre: toda la fila es
              // clicable, y el foco del teclado se ve (con `display: contents`
              // no había caja donde pintar el anillo).
              className="relative transition-colors hover:bg-muted/50"
              actions={
                d.contact ? (
                  <CrmRowActions className="relative z-10">
                    <CrmRowAction
                      icon={User}
                      label="Ver contacto"
                      onClick={() => router.push(`/admin/contacts/${d.contact!.id}`)}
                    />
                  </CrmRowActions>
                ) : undefined
              }
            >
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-medium">
                  <Link
                    href={`/admin/diagnosticos/${d.id}`}
                    className="rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {d.contact?.name ?? "Diagnóstico anónimo"}
                  </Link>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {d.contact?.email ?? d.contact?.phoneE164 ?? "Sin datos de contacto"}
                </p>
              </div>

              <div className="sm:w-32">
                {d.profile ? (
                  <Badge variant="secondary">{PROFILE_SHORT_LABEL[d.profile]}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
                {d.track && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {TRACK_LABEL[d.track]}
                  </p>
                )}
              </div>

              <div className="sm:w-36">
                <p className="text-xs text-muted-foreground">
                  Compromiso{" "}
                  <span className="font-medium text-foreground">
                    {d.commitmentScore ?? "—"}
                  </span>
                  {d.urgencyScore != null && (
                    <> · urgencia {d.urgencyScore}</>
                  )}
                </p>
              </div>

              <div className="min-w-0 sm:w-52">
                <p className="truncate text-xs text-muted-foreground">
                  {d.objection ?? "—"}
                </p>
                {d.sourceLabel && (
                  <p className="truncate text-xs text-muted-foreground">
                    Origen: {d.sourceLabel}
                  </p>
                )}
              </div>

              <div className="min-w-0 sm:w-40">
                {d.hasPurchased ? (
                  <Badge variant="secondary">Ya es cliente</Badge>
                ) : d.recommendedProductTitle ? (
                  // `block` para que `truncate` recorte de verdad: en línea el
                  // texto largo invadía el icono de «Ver contacto».
                  <span
                    className="block truncate text-xs text-muted-foreground"
                    title={`Se le recomendó ${d.recommendedProductTitle}`}
                  >
                    Se le recomendó {d.recommendedProductTitle}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}
    </CrmPageShell>
  );
};

export default DiagnosticosPageClient;
