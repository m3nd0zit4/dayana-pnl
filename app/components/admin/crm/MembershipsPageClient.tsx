"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { CourseMemberRow } from "@/lib/lms/course-admin";
import type { SubscriberRow, SubscriptionPlanRow } from "@/lib/crm/subscriptions";
import CourseMembersPageClient from "./CourseMembersPageClient";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmSegmentedControl from "./CrmSegmentedControl";
import SubscriptionsPageClient from "./SubscriptionsPageClient";
import { CrmPublicLink } from "./ui";

export type MembershipsTab = "personas" | "planes";

const SEGMENTS = [
  { id: "personas", label: "Personas" },
  { id: "planes", label: "Planes" },
] as const;

type Props = {
  preview: boolean;
  initialTab: MembershipsTab;
  courseTitle: string;
  courseProductId: string | null;
  members: CourseMemberRow[];
  plans: SubscriptionPlanRow[];
  subscribers: SubscriberRow[];
};

/**
 * Membresías: quién tiene acceso y qué cobros recurrentes lo sostienen.
 *
 * Eran dos pantallas —«Miembros» y «Suscripciones»— que leían las mismas
 * matrículas y se diferenciaban en el orden y en que una dejaba escribir. Aquí
 * son dos pestañas de la misma pantalla, cada una con la pregunta que contesta.
 *
 * La pestaña vive en la URL (`?tab=planes`) para que las rutas antiguas puedan
 * redirigir a la pestaña que les corresponde y un enlace compartido abra donde
 * se dejó.
 */
const MembershipsPageClient = ({
  preview,
  initialTab,
  courseTitle,
  courseProductId,
  members,
  plans,
  subscribers,
}: Props) => {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<MembershipsTab>(initialTab);

  const changeTab = (next: MembershipsTab) => {
    setTab(next);
    router.replace(next === "personas" ? pathname : `${pathname}?tab=${next}`, {
      scroll: false,
    });
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Membresías"
        description={`Quién tiene acceso a «${courseTitle}» y los planes de cobro recurrente que lo sostienen.`}
        secondaryActions={<CrmPublicLink href="/cursos" label="Ver cursos en la web" />}
      />

      <CrmSegmentedControl segments={SEGMENTS} value={tab} onChange={changeTab} />

      {tab === "personas" ? (
        <CourseMembersPageClient
          embedded
          preview={preview}
          courseTitle={courseTitle}
          courseProductId={courseProductId}
          initialMembers={members}
        />
      ) : (
        <SubscriptionsPageClient
          embedded
          preview={preview}
          plans={plans}
          subscribers={subscribers}
        />
      )}
    </CrmPageShell>
  );
};

export default MembershipsPageClient;
