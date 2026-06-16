"use client";

import Link from "next/link";
import { ChevronRight, MessageCircle } from "lucide-react";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ContactSearch from "@/app/components/admin/ContactSearch";
import CountrySelect from "./CountrySelect";
import SearchableSelect from "./SearchableSelect";
import { contactSourceSelectOptions } from "@/lib/crm/form-select-options";
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

        <form onSubmit={applyFilters} className="crm-filters">
          <div className="min-w-0 flex-1 sm:min-w-[200px]">
            <CountrySelect
              id="f-country"
              label="País"
              value={country}
              onChange={setCountry}
              allowEmpty
              emptyLabel="Todos los países"
            />
          </div>
          <div className="min-w-0 flex-1 sm:min-w-[160px]">
            <SearchableSelect
              id="f-source"
              label="Origen"
              value={source}
              options={contactSourceSelectOptions()}
              onChange={setSource}
              allowEmpty
              emptyLabel="Todos"
              searchMinOptions={99}
            />
          </div>
          <label className="flex min-h-[2.25rem] items-center gap-2 text-sm text-[var(--crm-muted)]">
            <input
              type="checkbox"
              checked={activeTherapy}
              onChange={(e) => setActiveTherapy(e.target.checked)}
            />
            Terapia activa
          </label>
          <button type="submit" className="crm-btn-secondary">
            Filtrar
          </button>
        </form>

        <div className="crm-group">
          {rows.length === 0 ? (
            <div className="crm-empty">
              <p className="crm-empty-title">Sin resultados</p>
              <p className="text-sm text-[var(--crm-muted)]">
                Crea un contacto o ajusta la búsqueda.
              </p>
            </div>
          ) : (
            rows.map((c) => (
              <div key={c.id} className="crm-group-row is-interactive">
                <Link
                  href={preview ? "#" : `/admin/contacts/${c.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {c.firstName} {c.lastName ?? ""}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-[var(--crm-muted)]">
                      {c.phoneE164}
                      {c.countryIso ? ` · ${formatCountryLabel(c.countryIso)}` : ""}
                    </div>
                    {c.enrollments.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.enrollments.slice(0, 2).map((en, i) => (
                          <span
                            key={`${c.id}-${i}`}
                            className="rounded-md bg-[var(--crm-fill-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--crm-foreground)]"
                          >
                            {en.product.title} · {enrollmentStatusLabel(en.status)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="crm-group-chevron shrink-0" aria-hidden />
                </Link>
                {!preview && buildContactWhatsAppUrl(c.phoneE164) && (
                  <a
                    href={buildContactWhatsAppUrl(c.phoneE164)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="crm-btn-icon size-9 shrink-0 text-[#128C7E]"
                    aria-label="WhatsApp"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MessageCircle className="size-4" strokeWidth={1.75} />
                  </a>
                )}
              </div>
            ))
          )}
        </div>
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
