"use client";

import Link from "next/link";
import { MessageCircle, Plus } from "lucide-react";
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
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="crm-section-title text-xl">Contactos</h1>
            <p className="crm-section-subtitle mt-1">
              Personas en el CRM. Agrega servicios al crear el contacto, desde su ficha o en{" "}
              <Link href="/admin/services" className="text-[var(--crm-accent)] hover:underline">
                Servicios
              </Link>
              .
            </p>
          </div>
          {!preview && (
            <button
              type="button"
              className="crm-btn-primary"
              onClick={() => setModalOpen(true)}
            >
              <Plus className="size-4" strokeWidth={2} />
              Nuevo contacto
            </button>
          )}
        </div>

        <ContactSearch initialQ={initialQ} />

        <form
          onSubmit={applyFilters}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--crm-border)] bg-white/60 p-4"
        >
          <div className="min-w-[200px]">
            <CountrySelect
              id="f-country"
              label="País"
              value={country}
              onChange={setCountry}
              allowEmpty
              emptyLabel="Todos los países"
            />
          </div>
          <div className="min-w-[160px]">
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
          <label className="flex items-center gap-2 pb-2 text-xs text-[var(--crm-muted)]">
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

        <div className="crm-surface-card overflow-hidden">
          <ul className="divide-y divide-[var(--crm-border)]">
            {rows.length === 0 && (
              <li className="p-8 text-center text-sm text-[var(--crm-muted)]">
                Sin resultados. Crea un contacto o ajusta la búsqueda.
              </li>
            )}
            {rows.map((c) => (
              <li key={c.id} className="crm-table-row">
                <div className="flex items-center justify-between gap-4 p-4">
                  <Link
                    href={preview ? "#" : `/admin/contacts/${c.id}`}
                    className="min-w-0 flex-1"
                  >
                    <div className="text-sm font-semibold">
                      {c.firstName} {c.lastName ?? ""}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-[var(--crm-muted)]">
                      {c.phoneE164}
                      {c.countryIso ? ` · ${formatCountryLabel(c.countryIso)}` : ""}
                    </div>
                    {c.enrollments.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.enrollments.map((en, i) => (
                          <span
                            key={`${c.id}-${i}`}
                            className="rounded-full border border-black/[0.06] bg-[var(--crm-linen)]/50 px-2 py-0.5 text-[10px] text-[var(--crm-foreground)]"
                          >
                            {en.product.title} · {enrollmentStatusLabel(en.status)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] text-[var(--crm-muted)]">
                        Sin servicios — agrega uno desde la ficha o Servicios
                      </p>
                    )}
                  </Link>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-xs text-[var(--crm-muted)]">
                      {c.enrollments.length} servicio(s)
                    </span>
                    {!preview && buildContactWhatsAppUrl(c.phoneE164) && (
                      <a
                        href={buildContactWhatsAppUrl(c.phoneE164)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="crm-btn-ghost flex items-center gap-1 text-xs text-[#128C7E]"
                      >
                        <MessageCircle className="size-3.5" />
                        WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
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
              message: "Abriendo el detalle del servicio…",
              variant: "success",
            });
            router.push(`/admin/enrollments/${result.enrollmentId}`);
            return;
          }
          if (result?.contactId) {
            toast({
              title: "Contacto creado",
              message: "Puedes agregar un servicio desde la ficha o en Servicios.",
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
