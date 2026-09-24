"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Compass, FileText, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import SendWhatsAppDialog from "@/app/components/admin/whatsapp/SendWhatsAppDialog";
import WhatsAppBulkSend from "@/app/components/admin/whatsapp/WhatsAppBulkSend";
import { diagnosticPresets } from "@/lib/crm/whatsapp-presets";
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
  /** Ultimo clic suyo hacia WhatsApp. */
  whatsappLeadAt: string | null;
  /** Ultimo clic del equipo en WhatsApp con ella. */
  whatsappStaffAt: string | null;
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

// Fecha y hora en que terminó el cuestionario, en la zona operativa fija
// (mismo motivo que abajo: servidor y navegador deben pintar lo mismo).
// Todo numérico y en 24 h: «sept.»/«sep.» y el espacio de «p. m.» cambian
// entre el ICU de Node y el del navegador, y eso rompe la hidratación.
const DIAGNOSTIC_DATE = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Bogota",
});

// Zona fija: esta lista se pinta en el servidor y se hidrata en el navegador;
// sin `timeZone` una fecha cerca de medianoche saldria distinta en cada lado.
const WHATSAPP_DATE = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  timeZone: "America/Bogota",
});
const whatsappDate = (iso: string) => WHATSAPP_DATE.format(new Date(iso)).replace(".", "");

type Segment = "todos" | "calientes" | "sin-contactar" | "sin-comprar";

const SEGMENTS = [
  { id: "calientes" as const, label: "Listos para hablar" },
  // La pregunta que se hacía a mano, fila por fila: «¿a esta ya le escribí?».
  { id: "sin-contactar" as const, label: "Sin contactar" },
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
 * Ordenada por fecha, lo más reciente primero, con la fecha en cada fila. El
 * segmento «Calientes» filtra por compromiso para decidir a quién llamar
 * primero. El orden lo pone la consulta (`listCompletedDiagnostics`), en SQL.
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
    urlSegment === "sin-comprar" ||
    urlSegment === "sin-contactar" ||
    urlSegment === "todos" ||
    urlSegment === "calientes"
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
  /**
   * Filas a las que se les acaba de escribir desde esta pantalla. El registro
   * viaja al servidor en segundo plano; sin esto la fila seguiría diciendo
   * «Sin contactar» hasta recargar, que es justo la duda que esto resuelve.
   */
  const [writtenNow, setWrittenNow] = useState<Set<string>>(new Set());
  const [waFor, setWaFor] = useState<{ diagnosticId: string; contactId: string; name: string } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = diagnosticos.filter((d) => {
      if (segment === "calientes") {
        if ((d.commitmentScore ?? 0) < HOT_COMMITMENT || d.hasPurchased) {
          return false;
        }
      }
      if (segment === "sin-comprar" && d.hasPurchased) return false;
      // Nadie del equipo le ha escrito todavía (y no se le acaba de escribir
      // desde esta misma pantalla).
      if (segment === "sin-contactar" && (d.whatsappStaffAt || writtenNow.has(d.id))) {
        return false;
      }
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
    // «Calientes» responde a «¿a quién llamo primero?»: ahí manda el
    // compromiso, y la fecha solo desempata.
    return segment === "calientes"
      ? [...rows].sort((a, b) => (b.commitmentScore ?? 0) - (a.commitmentScore ?? 0))
      : rows;
  }, [diagnosticos, segment, query, recentDays, nowMs, writtenNow]);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Diagnósticos"
        description="Quién respondió el cuestionario, qué necesita y cuándo quiere empezar. Del más reciente al más antiguo. Abre uno para ver todas sus respuestas."
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

      {!preview && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e9edef] bg-white p-3 dark:border-border dark:bg-card">
          <WhatsAppBulkSend
            contactIds={[
              ...new Set(
                filtered
                  .filter((d) => d.contact && !d.whatsappStaffAt && !writtenNow.has(d.id))
                  .map((d) => d.contact!.id)
              ),
            ]}
            presets={diagnosticPresets()}
            kind="diagnostico"
            title="Seguimiento de diagnósticos"
            label="Seguimiento por WhatsApp a los sin contactar"
            onDone={() =>
              setWrittenNow((prev) => {
                const next = new Set(prev);
                filtered.forEach((d) => next.add(d.id));
                return next;
              })
            }
          />
          <span className="text-xs text-[#667781]">De la lista filtrada, a quienes aún no les escribiste.</span>
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
          {filtered.map((d) => {
            const waUrl = d.contact?.phoneE164
              ? buildContactWhatsAppUrl(d.contact.phoneE164)
              : null;
            const written = writtenNow.has(d.id) || !!d.whatsappStaffAt;
            return (
            <CrmDataListRow
              key={d.id}
              // `relative` para el enlace estirado del nombre: toda la fila es
              // clicable, y el foco del teclado se ve (con `display: contents`
              // no había caja donde pintar el anillo).
              className="relative transition-colors hover:bg-muted/50"
              actions={
                <CrmRowActions className="relative z-10">
                  {/* Escribirle desde aquí: es lo que se hace con esta lista
                      en la mano, y deja la fila marcada al instante. */}
                  {!preview && waUrl && d.contact ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Enviar WhatsApp"
                      title="Enviar WhatsApp"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!d.contact) return;
                        setWaFor({
                          diagnosticId: d.id,
                          contactId: d.contact.id,
                          name: d.contact.name,
                        });
                      }}
                    >
                      <MessageCircle strokeWidth={1.75} aria-hidden />
                    </Button>
                  ) : null}
                  <CrmRowAction
                    icon={FileText}
                    label="Ver respuestas"
                    onClick={() => router.push(`/admin/diagnosticos/${d.id}`)}
                  />
                </CrmRowActions>
              }
            >
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-medium">
                  {/* La fila lleva a la PERSONA, que es donde se sigue la
                      conversación: historial, pagos y sus diagnósticos. Las
                      respuestas quedan a un clic, en «Ver respuestas». Un
                      diagnóstico sin ficha no tiene a dónde llevar, y va al
                      detalle. */}
                  <Link
                    href={
                      d.contact
                        ? `/admin/contacts/${d.contact.id}`
                        : `/admin/diagnosticos/${d.id}`
                    }
                    className="rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {d.contact?.name ?? "Diagnóstico anónimo"}
                  </Link>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {d.contact?.email ?? d.contact?.phoneE164 ?? "Sin datos de contacto"}
                </p>
                {d.completedAt ? (
                  <p className="truncate text-xs text-muted-foreground">
                    Hecho el {DIAGNOSTIC_DATE.format(new Date(d.completedAt))}
                  </p>
                ) : null}
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

              {/* Estado del contacto, a la vista: saber si ya le escribiste era
                  lo que obligaba a abrir las fichas una por una. */}
              <div className="min-w-0 sm:w-40">
                {!d.contact ? (
                  // Un diagnóstico sin ficha no tiene a quién escribirle.
                  <span className="text-xs text-muted-foreground">—</span>
                ) : written ? (
                  <Badge className="border-success/40 bg-success/10 text-success">
                    Le escribiste
                    {d.whatsappStaffAt ? ` ${whatsappDate(d.whatsappStaffAt)}` : " ahora"}
                  </Badge>
                ) : d.whatsappLeadAt ? (
                  <Badge variant="outline">
                    Te buscó {whatsappDate(d.whatsappLeadAt)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Sin contactar
                  </Badge>
                )}
              </div>
            </CrmDataListRow>
            );
          })}
        </CrmDataList>
      )}
      {waFor && (
        <SendWhatsAppDialog
          open
          onClose={() => setWaFor(null)}
          contactId={waFor.contactId}
          name={waFor.name}
          presets={diagnosticPresets()}
          source="diagnosticos"
          onSent={() => setWrittenNow((prev) => new Set(prev).add(waFor.diagnosticId))}
        />
      )}
    </CrmPageShell>
  );
};

export default DiagnosticosPageClient;
