"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import Link from "next/link";
import { ChevronRight, MessageCircle } from "lucide-react";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ContactSearch from "@/app/components/admin/ContactSearch";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
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

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (initialQ.trim()) p.set("q", initialQ.trim());
    if (country) p.set("country", country);
    if (source) p.set("source", source);
    if (activeTherapy) p.set("activeTherapy", "1");
    router.push(`/admin/contacts?${p}`);
  };

  return (
    <CrmPageShell>
      <div className="space-y-4">
        <CrmPageHeader
          title="Contactos"
          action={
            !preview ? (
              <CrmNewButton onClick={() => setModalOpen(true)} />
            ) : undefined
          }
        />

        <ContactSearch initialQ={initialQ} />

        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <CountrySelect
              id="f-country"
              label="País"
              value={country}
              onChange={setCountry}
              allowEmpty
              emptyLabel="Todos los países"
            />
          </div>
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <SearchableSelect
              id="f-source"
              label="Origen"
              value={source}
              options={contactFilterSourceSelectOptions()}
              onChange={setSource}
              allowEmpty
              emptyLabel="Todos"
              searchMinOptions={99}
            />
          </div>
          <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={activeTherapy}
              onCheckedChange={(checked) => setActiveTherapy(checked === true)}
            />
            Terapia activa
          </label>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </form>

        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {rows.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold">Sin resultados</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Crea un contacto o ajusta la búsqueda.
                </p>
              </div>
            ) : (
              rows.map((c) => (
                <div key={c.id} className="flex items-center gap-2 p-4 transition-colors hover:bg-muted/50">
                  <Link
                    href={preview ? "#" : `/admin/contacts/${c.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
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
                          c.enrollments.length === 0 && (
                          <Badge className="bg-violet-100 text-[10px] text-violet-700 dark:bg-violet-100 dark:text-violet-700">
                            Contacto pendiente
                          </Badge>
                        )}
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
                      {c.enrollments.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {c.enrollments.slice(0, 2).map((en, i) => (
                            <Badge key={`${c.id}-${i}`} variant="secondary" className="text-[10px]">
                              {en.product.title} · {enrollmentStatusLabel(en.status)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                  {!preview && buildContactWhatsAppUrl(c.phoneE164) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-[#128C7E]"
                      aria-label="WhatsApp"
                      onClick={(e) => e.stopPropagation()}
                      nativeButton={false}
                      render={
                        <a
                          href={buildContactWhatsAppUrl(c.phoneE164)!}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <MessageCircle strokeWidth={1.75} />
                    </Button>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

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
