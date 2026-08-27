"use client";

import { Compass } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/app/components/ui/badge";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmSegmentedControl from "./CrmSegmentedControl";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmFilterBar,
  CrmSearchInput,
} from "./ui";

export type DiagnosticoRow = {
  id: string;
  token: string;
  profile: "EXPLORADOR" | "EN_PROCESO" | "RAIZ_PROFUNDA" | null;
  urgencyScore: number | null;
  commitmentScore: number | null;
  recommendedProductId: string | null;
  source: string | null;
  completedAt: string | null;
  hasPurchased: boolean;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phoneE164: string;
  } | null;
  /** Qué dijo que la frenaba, ya traducido. */
  objection: string | null;
  /** Por qué Dayana, ya traducido. */
  whyDayana: string[];
};

const PROFILE_LABEL: Record<NonNullable<DiagnosticoRow["profile"]>, string> = {
  EXPLORADOR: "Explorador",
  EN_PROCESO: "En proceso",
  RAIZ_PROFUNDA: "Raíz profunda",
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
 */
const DiagnosticosPageClient = ({ preview, diagnosticos }: Props) => {
  const [segment, setSegment] = useState<Segment>("calientes");
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
      if (!q) return true;
      return [
        d.contact?.name,
        d.contact?.email,
        d.contact?.phoneE164,
        d.objection,
        ...d.whyDayana,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [diagnosticos, segment, query]);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Diagnósticos"
        description="Quién respondió el cuestionario, qué necesita y qué la está frenando. Ordenados por lo cerca que están de decidirse, no por fecha."
        trailing={
          <CrmSegmentedControl
            segments={SEGMENTS}
            value={segment}
            onChange={setSegment}
            aria-label="Filtrar diagnósticos"
          />
        }
      />

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
              actions={
                d.contact ? (
                  <Link
                    href={`/admin/contacts/${d.contact.id}`}
                    className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Ver contacto
                  </Link>
                ) : undefined
              }
            >
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-medium">
                  {d.contact?.name ?? "Sin contacto"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {d.contact?.email ?? d.contact?.phoneE164 ?? "—"}
                </p>
              </div>

              <div className="sm:w-32">
                {d.profile ? (
                  <Badge variant="secondary">{PROFILE_LABEL[d.profile]}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
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
                  {d.objection ? `Le frena: ${d.objection}` : "—"}
                </p>
                {d.whyDayana.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">
                    {d.whyDayana.join(" · ")}
                  </p>
                )}
              </div>

              <div className="sm:w-36">
                {d.hasPurchased ? (
                  <Badge variant="secondary">Ya compró</Badge>
                ) : d.recommendedProductId ? (
                  <span className="text-xs text-muted-foreground">
                    Se le ofreció {d.recommendedProductId}
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
