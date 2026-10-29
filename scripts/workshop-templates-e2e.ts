/**
 * «Plantillas de WhatsApp del taller» (29-oct): la dueña manda a aprobar la del
 * registro en la página y la de la invitación desde «Interesadas»
 * (`lib/crm/workshop-templates.ts`), contra `neondb_dev` y con un envío a Meta
 * FALSO: la base de desarrollo tiene una clave de 360dialog de verdad, así que
 * aquí nunca se llama a `createWhatsAppTemplate`.
 *
 * 1. Sin mandar: las dos se pueden mandar; mandarlas llama al falso con las dos
 *    recomendadas (Utilidad y Marketing) y deja un registro de auditoría por
 *    cada una (quién, desde qué taller, cómo terminó).
 * 2. En revisión: no se vuelve a mandar («already»), la otra sí.
 * 3. Rechazada (con motivo): se puede mandar otra vez y el motivo se lee.
 * 4. Aprobada como Marketing la de Utilidad: «Meta la pasó a Marketing», no se manda.
 * 5. Meta no la recibe (el falso falla): «failed» con el error, también auditado.
 * 6. Solo las pedidas (`keys`), y la de la invitación pasa por lo mismo
 *    (`submitInviteTemplate`, auditada).
 *
 *   bun --env-file=/e/Dev/Dayana/dayana-pnl/.env scripts/workshop-templates-e2e.ts
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  const { prisma } = await import("@/lib/db");
  const { listWorkshopTemplates, submitWorkshopTemplates } = await import("@/lib/crm/workshop-templates");
  const { submitInviteTemplate } = await import("@/lib/crm/workshop-invite");
  const { WORKSHOP_TEMPLATE_KEYS } = await import("@/lib/crm/workshop-templates-rules");
  const { REGISTRATION_TEMPLATE_KEY } = await import("@/lib/crm/workshop-registration-rules");
  const { INVITE_TEMPLATE_KEY } = await import("@/lib/crm/workshop-invite-rules");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
  };

  // Si ya existen de verdad en la base de desarrollo, no se tocan.
  const existing = await prisma.messageTemplate.count({ where: { key: { in: [...WORKSHOP_TEMPLATE_KEYS] } } });
  if (existing > 0) throw new Error("La base de desarrollo ya tiene filas de estas plantillas: no se tocan. Bórralas a mano si son de una prueba.");

  const staff = await prisma.staffUser.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  const staffId = staff?.id ?? null;
  const editionId = `e2e-plantillas-${Date.now()}`;
  const calls: { key: string; category: string }[] = [];
  const fake = { submitTemplate: async (t: { key: string; category: string }) => void calls.push({ key: t.key, category: t.category }) };
  const failing = {
    submitTemplate: async () => {
      throw new Error("360dialog: 400 prueba");
    },
  };
  const audits = () =>
    prisma.auditLog.findMany({
      where: { entityType: "WhatsAppTemplate", changes: { path: ["editionId"], equals: editionId } },
      orderBy: { createdAt: "asc" },
    });
  const tmp: string[] = [];
  const setRow = async (key: string, status: string, category: string) => {
    const row = await prisma.messageTemplate.upsert({
      where: { key_locale: { key, locale: "es" } },
      create: { key, locale: "es", title: key, body: "e2e", metaTemplateName: key, metaTemplateLang: "es", metaApprovalStatus: status, metaCategory: category },
      update: { metaApprovalStatus: status, metaCategory: category },
      select: { id: true },
    });
    if (!tmp.includes(row.id)) tmp.push(row.id);
  };
  const stateOf = async (key: string) => (await listWorkshopTemplates()).find((t) => t.key === key)!.state;

  try {
    // 1. Sin mandar.
    const before = await listWorkshopTemplates();
    check(
      "1. sin mandar: las dos se ven «Sin mandar a Meta» y se pueden mandar",
      before.length === 2 && before.every((t) => t.state.kind === "none" && t.state.submittable),
      before.map((t) => t.state)
    );
    const r1 = await submitWorkshopTemplates({ staffId, editionId, via: "e2e" }, fake);
    check(
      "   mandarlas llama al envío falso con las dos recomendadas (Utilidad y Marketing)",
      r1.every((r) => r.status === "submitted") &&
        calls.length === 2 &&
        calls.some((c) => c.key === REGISTRATION_TEMPLATE_KEY && c.category === "UTILITY") &&
        calls.some((c) => c.key === INVITE_TEMPLATE_KEY && c.category === "MARKETING"),
      { r1, calls }
    );
    const a1 = await audits();
    check(
      "   un registro de auditoría por cada una, con quién y cómo terminó",
      a1.length === 2 &&
        a1.every((a) => a.action === "CREATE" && a.staffUserId === staffId && (a.changes as { result?: string }).result === "submitted"),
      a1
    );
    // El falso no escribe la fila (createWhatsAppTemplate sí): sigue «sin mandar».

    // 2. En revisión la del registro.
    await setRow(REGISTRATION_TEMPLATE_KEY, "PENDING", "UTILITY");
    calls.length = 0;
    const r2 = await submitWorkshopTemplates({ staffId, editionId, via: "e2e" }, fake);
    check(
      "2. en revisión: no se vuelve a mandar; la otra sí",
      r2.find((r) => r.key === REGISTRATION_TEMPLATE_KEY)?.status === "already" &&
        r2.find((r) => r.key === INVITE_TEMPLATE_KEY)?.status === "submitted" &&
        calls.length === 1 &&
        calls[0].key === INVITE_TEMPLATE_KEY,
      { r2, calls }
    );
    check("   y se lee «En revisión de Meta»", (await stateOf(REGISTRATION_TEMPLATE_KEY)).label === "En revisión de Meta");

    // 3. Rechazada con motivo.
    await setRow(REGISTRATION_TEMPLATE_KEY, "REJECTED · INVALID_FORMAT", "UTILITY");
    const s3 = await stateOf(REGISTRATION_TEMPLATE_KEY);
    calls.length = 0;
    const r3 = await submitWorkshopTemplates({ staffId, editionId, keys: [REGISTRATION_TEMPLATE_KEY], via: "e2e" }, fake);
    check(
      "3. rechazada: se lee el motivo y se puede mandar otra vez (solo la pedida)",
      s3.kind === "rejected" && s3.detail.includes("formato no es válido") && r3.length === 1 && r3[0].status === "submitted" && calls.length === 1,
      { s3, r3, calls }
    );

    // 4. Aprobada como Marketing la de Utilidad.
    await setRow(REGISTRATION_TEMPLATE_KEY, "APPROVED", "MARKETING");
    const s4 = await stateOf(REGISTRATION_TEMPLATE_KEY);
    const r4 = await submitWorkshopTemplates({ staffId, editionId, keys: [REGISTRATION_TEMPLATE_KEY], via: "e2e" }, fake);
    check(
      "4. Meta la pasó a Marketing: se dice y no se manda",
      s4.label === "Meta la pasó a Marketing" && !s4.submittable && r4[0].status === "already",
      { s4, r4 }
    );
    await setRow(INVITE_TEMPLATE_KEY, "APPROVED", "MARKETING");
    check("   la invitación aprobada como Marketing es lo pedido: «Aprobada como Marketing»", (await stateOf(INVITE_TEMPLATE_KEY)).label === "Aprobada como Marketing");

    // 5. Meta no la recibe.
    await setRow(INVITE_TEMPLATE_KEY, "REJECTED", "MARKETING");
    const r5 = await submitWorkshopTemplates({ staffId, editionId, keys: [INVITE_TEMPLATE_KEY], via: "e2e" }, failing);
    const a5 = (await audits()).at(-1);
    const f5 = r5[0];
    check(
      "5. si Meta no la recibe: «failed» con el error, y queda auditado",
      f5?.status === "failed" &&
        f5.error.includes("400 prueba") &&
        (a5?.changes as { result?: string; error?: string } | undefined)?.result === "failed",
      { r5, a5 }
    );

    // 6. La invitación por su propio botón (y al empezar el envío) pasa por lo mismo.
    calls.length = 0;
    const r6 = await submitInviteTemplate(fake, { staffId, editionId });
    const a6 = (await audits()).at(-1);
    check(
      "6. «Mandar la plantilla a aprobar» de la invitación: misma regla y auditada",
      r6.status === "submitted" &&
        calls.length === 1 &&
        (a6?.changes as { via?: string; key?: string } | undefined)?.via === "invitacion" &&
        (a6?.changes as { key?: string } | undefined)?.key === INVITE_TEMPLATE_KEY,
      { r6, a6 }
    );
    await setRow(INVITE_TEMPLATE_KEY, "PENDING", "MARKETING");
    check("   ya en revisión: «already», sin llamar a Meta", (await submitInviteTemplate(fake, { staffId, editionId })).status === "already" && calls.length === 1);
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityType: "WhatsAppTemplate", changes: { path: ["editionId"], equals: editionId } } });
    if (tmp.length) await prisma.messageTemplate.deleteMany({ where: { id: { in: tmp } } });
    await prisma.$disconnect();
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(", ")}` : "\n✅ Todo bien");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
