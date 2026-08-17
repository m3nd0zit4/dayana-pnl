"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import Link from "next/link";
import { ChevronRight, MessageCircle, Users } from "lucide-react";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ContactSearch from "@/app/components/admin/ContactSearch";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import CountrySelect from "./CountrySelect";
import SearchableSelect from "./SearchableSelect";
import { contactFilterSourceSelectOptions } from "@/lib/crm/form-select-options";
import ContactFormModal from "./ContactFormModal";
import { formatCountryLabel } from "@/lib/countries";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmFilterBar,
  CrmLoadMore,
  CrmRowActions,
} from "./ui";

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string;
  countryIso: string | null;
  source: string;
  /** ISO date string — cuándo se creó el contacto. */
  createdAt: string;
  /** Tiene al menos un pago aprobado — llegó comprando, no pidiendo contacto. */
  hasPayment: boolean;
  enrollments: {
    status: string;
    product: { title: string };
  }[];
};

type Filters = {
  country: string;
  source: string;
  activeTherapy: boolean;
  searchNotes: boolean;
};

type Props = {
  /** Primera página, pintada por el servidor. */
  rows: ContactRow[];
  /** Cursor keyset de la siguiente página; `null` si no hay más. */
  initialCursor: string | null;
  /** Contactos que casan con los filtros — NO el tamaño de página. */
  total: number;
  initialQ: string;
  filters: Filters;
  preview: boolean;
};

const numberFormat = new Intl.NumberFormat("es-CO");

const ContactsPageClient = ({
  rows,
  initialCursor,
  total,
  initialQ,
  filters,
  preview,
}: Props) => {
  const router = useRouter();
  const { toast } = useCrm();
  const [modalOpen, setModalOpen] = useState(false);
  const [country, setCountry] = useState(filters.country);
  const [source, setSource] = useState(filters.source);
  const [activeTherapy, setActiveTherapy] = useState(filters.activeTherapy);
  const [searchNotes, setSearchNotes] = useState(filters.searchNotes);

  // Las páginas que va añadiendo «Cargar más». Filtrar y buscar navegan con
  // router.push, que vuelve a renderizar este mismo componente con una primera
  // página nueva en vez de desmontarlo — de ahí el efecto que reinicia el
  // acumulado. Sin él, los resultados del filtro anterior se quedarían pegados
  // debajo de los nuevos.
  const [items, setItems] = useState(rows);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setItems(rows);
    setCursor(initialCursor);
  }, [rows, initialCursor]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ cursor });
      if (initialQ.trim()) p.set("q", initialQ.trim());
      if (country) p.set("country", country);
      if (source) p.set("source", source);
      if (activeTherapy) p.set("activeTherapy", "1");
      if (searchNotes) p.set("notes", "1");

      const res = await fetch(`/api/admin/contacts?${p}`);
      if (!res.ok) throw new Error("load_failed");
      const data = (await res.json()) as {
        contacts: ContactRow[];
        nextCursor: string | null;
      };
      setItems((prev) => [...prev, ...data.contacts]);
      setCursor(data.nextCursor);
    } catch {
      toast("No se pudieron cargar más contactos");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Se filtra al cambiar, no al enviar (regla R10).
   *
   * Antes había un botón «Filtrar» que había que pulsar después de tocar los
   * desplegables. Como los tres controles son discretos —dos selects y una
   * casilla— cada cambio ya es una intención completa: no hay nada que esperar
   * a que el usuario «termine» de escribir, así que el botón solo añadía un
   * paso. La búsqueda por texto sigue aparte, en `ContactSearch`, que es quien
   * necesita el retardo.
   */
  const pushFilters = (next: Partial<Filters>) => {
    const merged = { country, source, activeTherapy, searchNotes, ...next };
    const p = new URLSearchParams();
    if (initialQ.trim()) p.set("q", initialQ.trim());
    if (merged.country) p.set("country", merged.country);
    if (merged.source) p.set("source", merged.source);
    if (merged.activeTherapy) p.set("activeTherapy", "1");
    if (merged.searchNotes) p.set("notes", "1");
    router.push(`/admin/contacts?${p}`);
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Contactos"
        description="Todas las personas que han pasado por la web, el checkout o una consulta."
        action={
          !preview ? (
            <CrmNewButton onClick={() => setModalOpen(true)} />
          ) : undefined
        }
      />

      <ContactSearch initialQ={initialQ} />

      {/* El recuento es el TOTAL que casa con los filtros, no las filas
          cargadas. Antes era `rows.length`, es decir el tamaño de página, y
          por eso decía siempre «80 contactos». */}
      <CrmFilterBar
        count={
          items.length < total
            ? `${numberFormat.format(items.length)} de ${numberFormat.format(total)} contactos`
            : `${numberFormat.format(total)} ${total === 1 ? "contacto" : "contactos"}`
        }
      >
        <div className="w-full sm:w-52">
          <CountrySelect
            id="f-country"
            label="País"
            value={country}
            onChange={(v) => {
              setCountry(v);
              pushFilters({ country: v });
            }}
            allowEmpty
            emptyLabel="Todos los países"
          />
        </div>
        <div className="w-full sm:w-48">
          <SearchableSelect
            id="f-source"
            label="Origen"
            value={source}
            options={contactFilterSourceSelectOptions()}
            onChange={(v) => {
              setSource(v);
              pushFilters({ source: v });
            }}
            allowEmpty
            emptyLabel="Todos los orígenes"
            searchMinOptions={99}
          />
        </div>
        <label className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={activeTherapy}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setActiveTherapy(next);
              pushFilters({ activeTherapy: next });
            }}
          />
          Terapia activa
        </label>
        {/* Buscar en notas es el camino lento: `notes` es @db.Text sin cota, y
            leerla por fila es lo que no escala. Existe, pero se pide. */}
        <label className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={searchNotes}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setSearchNotes(next);
              pushFilters({ searchNotes: next });
            }}
          />
          Buscar en notas
        </label>
      </CrmFilterBar>

      <CrmDataList>
        {items.length === 0 ? (
          <CrmEmptyState
            icon={Users}
            title="Sin resultados"
            description="Crea un contacto o ajusta la búsqueda y los filtros."
          />
        ) : (
          items.map((c) => {
            const whatsAppUrl = buildContactWhatsAppUrl(c.phoneE164);
            return (
              <CrmDataListRow
                key={c.id}
                className="gap-2 py-0 pr-2 pl-0 transition-colors hover:bg-muted/50"
                actions={
                  !preview && whatsAppUrl ? (
                    <CrmRowActions>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Escribir por WhatsApp"
                        title="Escribir por WhatsApp"
                        onClick={(e) => e.stopPropagation()}
                        nativeButton={false}
                        render={
                          <a
                            href={whatsAppUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        <MessageCircle strokeWidth={1.75} aria-hidden />
                      </Button>
                    </CrmRowActions>
                  ) : undefined
                }
              >
                <Link
                  href={preview ? "#" : `/admin/contacts/${c.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      {c.firstName} {c.lastName ?? ""}
                      {/* Llegó por el formulario "Hablemos sin prisa" del home
                          y aún no tiene servicio ni pago — está esperando
                          que lo contacten. Al asignarle un servicio (con o
                          sin pago) deja de estar pendiente. */}
                      {c.source === "WEB_LEAD_FORM" &&
                      !c.hasPayment &&
                      c.enrollments.length === 0 ? (
                        <Badge className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                          Contacto pendiente
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {displayContactPhone(c.phoneE164) ?? "Sin teléfono"}
                      {c.countryIso ? ` · ${formatCountryLabel(c.countryIso)}` : ""}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Creado el{" "}
                      {new Date(c.createdAt).toLocaleDateString("es-CO", {
                        dateStyle: "medium",
                      })}
                    </div>
                    {c.enrollments.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.enrollments.slice(0, 2).map((en, i) => (
                          <Badge
                            key={`${c.id}-${i}`}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {en.product.title} · {enrollmentStatusLabel(en.status)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              </CrmDataListRow>
            );
          })
        )}
      </CrmDataList>

      <CrmLoadMore
        hasMore={cursor !== null}
        loading={loading}
        onClick={loadMore}
      />

      <ContactFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(result) => {
          setModalOpen(false);
          if (result?.enrollmentId) {
            toast({
              title: "Contacto y servicio creados",
              message: "Abriendo el detalle…",
              variant: "success",
            });
            router.push(`/admin/enrollments/${result.enrollmentId}`);
            return;
          }
          if (result?.contactId) {
            toast({
              title: "Contacto creado",
              message: "Puedes agregar un servicio desde la ficha.",
              variant: "success",
            });
            router.push(`/admin/contacts/${result.contactId}?tab=servicios`);
            return;
          }
          router.refresh();
        }}
      />
    </CrmPageShell>
  );
};

export default ContactsPageClient;
