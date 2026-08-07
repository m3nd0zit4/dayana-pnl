"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import Link from "next/link";
import { ChevronRight, MessageCircle, Users } from "lucide-react";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
};

type Props = {
  rows: ContactRow[];
  initialQ: string;
  filters: Filters;
  preview: boolean;
};

const ContactsPageClient = ({ rows, initialQ, filters, preview }: Props) => {
  const router = useRouter();
  const { toast } = useCrm();
  const [modalOpen, setModalOpen] = useState(false);
  const [country, setCountry] = useState(filters.country);
  const [source, setSource] = useState(filters.source);
  const [activeTherapy, setActiveTherapy] = useState(filters.activeTherapy);

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
    const merged = { country, source, activeTherapy, ...next };
    const p = new URLSearchParams();
    if (initialQ.trim()) p.set("q", initialQ.trim());
    if (merged.country) p.set("country", merged.country);
    if (merged.source) p.set("source", merged.source);
    if (merged.activeTherapy) p.set("activeTherapy", "1");
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

      <CrmFilterBar
        count={`${rows.length} ${rows.length === 1 ? "contacto" : "contactos"}`}
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
      </CrmFilterBar>

      <CrmDataList>
        {rows.length === 0 ? (
          <CrmEmptyState
            icon={Users}
            title="Sin resultados"
            description="Crea un contacto o ajusta la búsqueda y los filtros."
          />
        ) : (
          rows.map((c) => {
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
