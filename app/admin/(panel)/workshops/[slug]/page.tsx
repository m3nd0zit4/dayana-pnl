import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarRange, MessageCircle } from "lucide-react";

import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import EditionStatusBadge from "@/app/components/admin/crm/editions/EditionStatusBadge";
import EditionTabs from "@/app/components/admin/crm/editions/EditionTabs";
import { CrmEmptyState, CrmPublicLink } from "@/app/components/admin/crm/ui";
import WorkshopDetailActions from "@/app/components/admin/crm/workshops/WorkshopDetailActions";
import WorkshopDocumentsPanel from "@/app/components/admin/crm/workshops/WorkshopDocumentsPanel";
import WorkshopEmailNotifyButton from "@/app/components/admin/crm/workshops/WorkshopEmailNotifyButton";
import WorkshopEnrollmentsPanel from "@/app/components/admin/crm/workshops/WorkshopEnrollmentsPanel";
import WorkshopHistory from "@/app/components/admin/crm/workshops/WorkshopHistory";
import WorkshopPageEditor from "@/app/components/admin/crm/workshops/WorkshopPageEditor";
import WorkshopPriceEditor from "@/app/components/admin/crm/workshops/WorkshopPriceEditor";
import { parseWorkshopTab, workshopTabSpecs, type WorkshopTab } from "@/app/components/admin/crm/workshops/tabs";
import PeopleWhatsAppList from "@/app/components/admin/whatsapp/PeopleWhatsAppList";
import WhatsAppBulkSend from "@/app/components/admin/whatsapp/WhatsAppBulkSend";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { canManageTeam } from "@/lib/crm/staff-permissions";
import { currentSlugForPrevious, listWorkshopDocuments } from "@/lib/crm/workshop-editions";
import { getWorkshopPublishBlockers } from "@/lib/crm/workshop-lifecycle";
import {
  isWorkshopEnded,
  workshopBlockersMessage,
  workshopDescriptionOf,
  workshopStartsAtHasTime,
} from "@/lib/crm/workshop-lifecycle-rules";
import {
  getOpenWorkshop,
  getWorkshopForPanel,
  getWorkshopTimeline,
  listWorkshopEnrollments,
  listWorkshopInviteContactIds,
  listWorkshopPeopleForWhatsApp,
  workshopDateLabel,
  workshopEnrollmentStats,
  type WorkshopForPanel,
} from "@/lib/crm/workshop-panel";
import { WORKSHOP_WA_TEMPLATE_KEY, workshopWaRemindersEnabled } from "@/lib/crm/workshop-whatsapp-reminders";
import { workshopPresets } from "@/lib/crm/whatsapp-presets";
import { getWhatsAppTemplateStatus } from "@/lib/crm/whatsapp-templates";
import { getDateKeyInTz, getTimeHmInTz } from "@/lib/datetime/zoned-time";
import { parseWorkshopSchedule } from "@/lib/workshop-schedule";
import { formatMoneyMinor } from "@/lib/crm/money";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
};

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** «Inscritas»: quién pagó y qué recordatorios le llegaron. */
const EnrollmentsTab = async ({ edition, blockedReason }: { edition: WorkshopForPanel; blockedReason: string | null }) => {
  const [rows, stats, waEnabled, templateStatus] = await Promise.all([
    listWorkshopEnrollments(edition.id, { take: 50 }),
    workshopEnrollmentStats(edition.id),
    workshopWaRemindersEnabled(),
    getWhatsAppTemplateStatus(WORKSHOP_WA_TEMPLATE_KEY).catch(() => null),
  ]);
  return (
    <WorkshopEnrollmentsPanel
      key={edition.id}
      slug={edition.slug}
      enrollments={rows}
      stats={stats}
      whatsApp={{ enabled: waEnabled, templateStatus }}
      blockedReason={blockedReason}
    />
  );
};

/**
 * «WhatsApp»: las personas de la edición con los mensajes que tienen sentido
 * (invitación, recordatorio con el enlace) y —solo mientras está publicada— la
 * invitación a quienes aceptaron recibir novedades, por WhatsApp o por correo.
 * Todo lo que se envía desde aquí queda en la historia del taller.
 */
const WhatsAppTab = async ({ edition, tz }: { edition: WorkshopForPanel; tz: string }) => {
  const isOpen = edition.status === "OPEN" && !isWorkshopEnded(edition);
  const [people, inviteIds] = await Promise.all([
    listWorkshopPeopleForWhatsApp(edition.id),
    isOpen ? listWorkshopInviteContactIds(edition.id) : Promise.resolve([] as string[]),
  ]);
  // El enlace de la reunión es de quien pagó: el recordatorio que lo lleva
  // solo se ofrece para ellas; a las demás y a las invitadas, sin él.
  const presets = workshopPresets(edition, tz);
  const withoutLink = presets.filter((p) => p.id !== "recordatorio");
  const paid = people.filter((p) => p.paid);
  const others = people.filter((p) => !p.paid);
  const link = { workshopEditionId: edition.id };
  return (
    <div className="flex flex-col gap-4">
      {isOpen ? (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Invitar al taller</div>
            <div className="text-xs text-muted-foreground">
              {inviteIds.length.toLocaleString("es-CO")} contactos aceptaron recibir novedades y todavía no están en
              este taller.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WorkshopEmailNotifyButton editionId={edition.id} title={edition.title} />
            <WhatsAppBulkSend
              contactIds={inviteIds}
              presets={withoutLink}
              kind="taller"
              title={`Taller: ${edition.title} (invitación)`}
              label="Invitar por WhatsApp"
              link={link}
            />
          </div>
        </section>
      ) : null}

      {people.length === 0 ? (
        <CrmEmptyState
          icon={MessageCircle}
          title="Todavía no hay inscritas"
          description={
            isOpen
              ? "Cuando alguien se inscriba podrás escribirle desde aquí. Mientras, invita arriba."
              : "Cuando alguien se inscriba podrás escribirle desde aquí."
          }
        />
      ) : (
        <>
          {paid.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Pagaron ({paid.length.toLocaleString("es-CO")})</h2>
              <PeopleWhatsAppList
                key={`${edition.id}:pagaron`}
                people={paid}
                allContactIds={paid.map((p) => p.contactId)}
                presets={presets}
                kind="taller"
                title={`Taller: ${edition.title}`}
                source="talleres"
                allLabel="Enviar a todas las que pagaron"
                link={link}
              />
            </section>
          ) : null}
          {others.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Sin pagar ({others.length.toLocaleString("es-CO")})</h2>
              <p className="text-xs text-muted-foreground">
                Interesadas o con el pago pendiente: a ellas no se les manda el enlace de la reunión.
              </p>
              <PeopleWhatsAppList
                key={`${edition.id}:sin-pagar`}
                people={others}
                allContactIds={others.map((p) => p.contactId)}
                presets={withoutLink}
                kind="taller"
                title={`Taller: ${edition.title} (sin pagar)`}
                source="talleres"
                allLabel="Enviar a todas las que no han pagado"
                link={link}
              />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};

/**
 * Un taller, igual que un evento gratuito: su página, su precio, sus inscritas,
 * sus documentos, WhatsApp y su historia, cada uno en su pestaña (`?tab=`). El
 * paso que le toca (publicar, cerrar inscripciones, terminar, reabrir) va en la
 * cabecera.
 */
const WorkshopDetailPage = async ({ params, searchParams }: PageProps) => {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const tab: WorkshopTab = parseWorkshopTab(sp.tab);

  if (isCrmUiPreview()) {
    return (
      <CrmPageShell>
        <CrmPageHeader
          title="Taller"
          backHref="/admin/workshops"
          backLabel="Talleres"
          secondaryActions={
            <CrmPublicLink href={`/taller-virtual/${slug}`} label="Ver en web" disabledReason="Vista previa sin datos." />
          }
          trailing={
            <EditionTabs
              basePath={`/admin/workshops/${slug}`}
              value={tab}
              tabs={workshopTabSpecs({ paid: 0, documents: 0 })}
              ariaLabel="Secciones del taller"
            />
          }
        />
        <CrmEmptyState icon={CalendarRange} title="Vista previa sin datos" />
      </CrmPageShell>
    );
  }

  const edition = await getWorkshopForPanel(slug);
  if (!edition) {
    // URL cambiada: los enlaces viejos llevan a la nueva.
    const renamed = await currentSlugForPrevious(slug);
    if (renamed) redirect(`/admin/workshops/${encodeURIComponent(renamed)}?tab=${tab}`);
    notFound();
  }

  const [tz, openWorkshop, blockers, staff] = await Promise.all([
    getOperationalTimezone(),
    getOpenWorkshop(),
    getWorkshopPublishBlockers(edition),
    getStaffSession().catch(() => null),
  ]);
  const ended = isWorkshopEnded(edition);
  const status = ended ? "COMPLETED" : edition.status;
  const publishBlockedReason =
    !ended && edition.status !== "OPEN" && blockers.length > 0
      ? `${workshopBlockersMessage(blockers)}. ${blockers.some((b) => b !== "pastDate") ? "Complétalo en «Página» y «Precio»." : ""}`.trim()
      : null;
  // Lo que le falta para que salgan los recordatorios a quien pagó.
  const reminderGap = ended
    ? null
    : !edition.startsAt
      ? "Sin fecha no sale ningún recordatorio."
      : !edition.meetingUrl
        ? "Sin el enlace de la reunión (pestaña «Página») no sale ningún recordatorio."
        : null;

  const lifecycleHint =
    status === "OPEN"
      ? "«Cerrar inscripciones» deja de venderlo pero quien pagó sigue recibiendo el enlace y los recordatorios; «Terminar» corta todo."
      : status === "CLOSED"
        ? "Inscripciones cerradas: quien ya pagó sigue recibiendo el enlace y los recordatorios. «Terminar» corta todo."
        : null;
  const description = (
    <>
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <EditionStatusBadge status={status} />
        <span>{workshopDateLabel(edition, tz)}</span>
      </span>
      {/* En el teléfono no cabe: lo explica la confirmación de cada botón. */}
      {lifecycleHint ? <span className="mt-1 hidden text-xs sm:block">{lifecycleHint}</span> : null}
      {publishBlockedReason ? <span className="mt-1 block text-xs text-warning">{publishBlockedReason}</span> : null}
      {!publishBlockedReason && (status === "OPEN" || status === "CLOSED") && reminderGap ? (
        <span className="mt-1 block text-xs text-warning">{reminderGap}</span>
      ) : null}
    </>
  );

  let content: React.ReactNode;
  if (tab === "precio") {
    const legacyPrice = [
      edition.prices.cop != null ? `$ ${formatMoneyMinor(edition.prices.cop, "COP")} COP` : null,
      edition.prices.usd != null ? `US$${formatMoneyMinor(edition.prices.usd, "USD")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    content = (
      <WorkshopPriceEditor
        key={edition.id}
        slug={edition.slug}
        status={status}
        prices={edition.prices}
        legacy={edition.legacyProduct ? { productTitle: edition.productTitle ?? "vinculado", priceText: legacyPrice } : null}
      />
    );
  } else if (tab === "inscritas") {
    content = <EnrollmentsTab edition={edition} blockedReason={reminderGap} />;
  } else if (tab === "documentos") {
    const documents = await listWorkshopDocuments(edition.id);
    content = (
      <WorkshopDocumentsPanel
        key={edition.id}
        slug={edition.slug}
        documents={documents.map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes }))}
      />
    );
  } else if (tab === "whatsapp") {
    content = <WhatsAppTab edition={edition} tz={tz} />;
  } else if (tab === "historia") {
    content = <WorkshopHistory timeline={await getWorkshopTimeline(edition.id, tz)} timeZone={tz} />;
  } else {
    const hasTime = workshopStartsAtHasTime(edition);
    content = (
      <WorkshopPageEditor
        key={edition.id}
        operationalTimezone={tz}
        initial={{
          slug: edition.slug,
          title: edition.title,
          description: workshopDescriptionOf(edition),
          editionLabel: edition.editionLabel ?? "",
          dateKey: edition.startsAt ? getDateKeyInTz(edition.startsAt, tz) : "",
          timeHm: edition.startsAt && hasTime ? getTimeHmInTz(edition.startsAt, tz) : "",
          dateLabel: edition.dateLabel ?? "",
          scheduleLabel: edition.scheduleLabel ?? "",
          capacity: edition.capacity,
          meetingUrl: edition.meetingUrl ?? "",
          focusTopics: stringList(edition.focusTopics),
          daySchedule: parseWorkshopSchedule(edition.daySchedule),
          ended,
        }}
      />
    );
  }

  return (
    <CrmPageShell>
      <CrmPageHeader
        title={edition.title}
        description={description}
        backHref="/admin/workshops"
        backLabel="Talleres"
        secondaryActions={
          <WorkshopDetailActions
            edition={{ id: edition.id, slug: edition.slug, title: edition.title, status, paid: edition.paidCount }}
            openOther={openWorkshop && openWorkshop.id !== edition.id ? { id: openWorkshop.id, title: openWorkshop.title } : null}
            publishBlockedReason={publishBlockedReason}
            ownerPreview={Boolean(staff && canManageTeam(staff.role))}
          />
        }
        trailing={
          <EditionTabs
            key={tab}
            basePath={`/admin/workshops/${encodeURIComponent(edition.slug)}`}
            value={tab}
            tabs={workshopTabSpecs({ paid: edition.paidCount, documents: edition.documentsCount })}
            ariaLabel="Secciones del taller"
          />
        }
      />
      {content}
      {tab === "inscritas" && edition.paidCount > 0 ? (
        <Link
          href={`/admin/workshops/${encodeURIComponent(edition.slug)}?tab=whatsapp`}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Escribirles por WhatsApp
        </Link>
      ) : null}
    </CrmPageShell>
  );
};

export default WorkshopDetailPage;
