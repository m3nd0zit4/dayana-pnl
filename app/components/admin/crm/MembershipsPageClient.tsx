"use client";

import { UserPlus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { CourseMemberRow } from "@/lib/lms/course-admin";
import type { SubscriberRow, SubscriptionPlanRow } from "@/lib/crm/subscriptions";
import CourseMembersPageClient, { type MemberFilter } from "./CourseMembersPageClient";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";
import CrmSegmentedControl from "./CrmSegmentedControl";
import SubscriptionsPageClient from "./SubscriptionsPageClient";
import { CrmPublicLink } from "./ui";

export type MembershipsTab = "personas" | "planes";

// Los ids de pestaña se quedan como estaban (`?tab=planes`): las rutas antiguas
// redirigen a ellos y hay enlaces compartidos. Sólo cambia lo que se lee.
const SEGMENTS = [
  { id: "personas", label: "Miembros" },
  { id: "planes", label: "Suscripciones" },
] as const;

type Props = {
  preview: boolean;
  initialTab: MembershipsTab;
  memberFilter: MemberFilter | null;
  courseTitle: string;
  courseProductId: string | null;
  members: CourseMemberRow[];
  plans: SubscriptionPlanRow[];
  subscribers: SubscriberRow[];
};

/**
 * Membresías: quién tiene acceso y quién paga cada mes.
 *
 * Eran dos pantallas —«Miembros» y «Suscripciones»— que leían las mismas
 * matrículas. Aquí son dos pestañas de la misma pantalla.
 *
 * «Nuevo miembro» vive en esta cabecera, no dentro de la pestaña: una acción
 * de crear pintada suelta en el cuerpo es justo lo que el contrato (R2)
 * prohíbe, y en la vista previa nadie lo veía porque ahí no se pinta.
 */
const MembershipsPageClient = ({
  preview,
  initialTab,
  memberFilter,
  courseTitle,
  courseProductId,
  members,
  plans,
  subscribers,
}: Props) => {
  const router = useRouter();
  const pathname = usePathname();
  const { canWrite } = useCrm();
  const [tab, setTab] = useState<MembershipsTab>(initialTab);
  const [newMemberOpen, setNewMemberOpen] = useState(false);

  const changeTab = (next: MembershipsTab) => {
    setTab(next);
    // `push`, no `replace`: cada pestaña es un paso atrás posible con el botón
    // del navegador, que era lo que se esperaba y no pasaba.
    router.push(next === "personas" ? pathname : `${pathname}?tab=${next}`, {
      scroll: false,
    });
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Membresías"
        description={`Quién tiene acceso a «${courseTitle}» y quién paga cada mes.`}
        secondaryActions={<CrmPublicLink href="/cursos" label="Ver cursos en la web" />}
        action={
          tab === "personas" && !preview && canWrite && courseProductId ? (
            <CrmNewButton
              label="Nuevo miembro"
              icon={UserPlus}
              onClick={() => setNewMemberOpen(true)}
            />
          ) : undefined
        }
      />

      <CrmSegmentedControl segments={SEGMENTS} value={tab} onChange={changeTab} />

      {tab === "personas" ? (
        <CourseMembersPageClient
          embedded
          preview={preview}
          courseTitle={courseTitle}
          courseProductId={courseProductId}
          initialMembers={members}
          initialFilter={memberFilter}
          newMemberOpen={newMemberOpen}
          onNewMemberOpenChange={setNewMemberOpen}
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
