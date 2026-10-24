/**
 * Las interesadas en un taller (`workshop-interests.ts`): quién preguntó por
 * él por WhatsApp, para el seguimiento de Dayana. Contra la base de
 * DESARROLLO, con un taller y chats de prueba que se borran al final.
 *
 *   bun --env-file=.env scripts/whatsapp-workshop-interest-e2e.ts
 *
 * 1. Preguntó el costo (y luego el horario): una fila, 2 veces.
 * 2. Preguntó por el botón de la página dos días ANTES de crear el taller: entra.
 * 3. «Son del taller de jabones?»: no entra. Hace 5 días: tampoco (se lee desde 3 días antes de crearlo).
 *    En dos mensajes («para el 15 de noviembre» + «El taller») y sin «taller» («la sanación con el dinero»): entran.
 * 4. Leer otra vez no suma nada (cursor).
 * 5. Marcar el seguimiento; otra edición no puede.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  const { prisma } = await import("@/lib/db");
  const { listWorkshopInterests, setWorkshopInterestStatus, syncWorkshopInterests } = await import("@/lib/crm/workshop-interests");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
  };

  const run = Date.now().toString().slice(-6);
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600_000);
  const edition = await prisma.workshopEdition.create({
    data: {
      slug: `e2e-taller-${run}`,
      title: "Tu Sanacion con el Dinero",
      status: "DRAFT",
      startsAt: new Date("2026-11-15T17:00:00Z"),
      startsAtHasTime: false,
      timezone: "America/Bogota",
      scheduleLabel: "8:30 a.m. – 4:30 p.m. · virtual",
    },
  });
  const forSync = { ...edition, createdAt: edition.createdAt };
  const ids: string[] = [];
  const chat = async (suffix: string, lines: { body: string; at: Date }[]) => {
    const conv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: `5730088${run}${suffix}`, metaAccountId: "test-phone-id", participantName: `Prueba Taller ${suffix}` },
    });
    ids.push(conv.id);
    for (const l of lines) {
      await prisma.conversationMessage.create({
        data: { conversationId: conv.id, direction: "INBOUND", kind: "message", body: l.body, sentAt: l.at, status: "RECEIVED" },
      });
    }
    return conv.id;
  };

  try {
    const a = await chat("1", [
      { body: "El costo del taller del 15 de noviembre?", at: ago(2) },
      { body: "Perú", at: ago(1.9) },
      { body: "¿y el horario del taller?", at: ago(1) },
    ]);
    const c = await chat("2", [{ body: 'Hola Dayana, me interesa inscribirme al taller "Tu Sanacion con el Dinero".', at: ago(48) }]);
    const b = await chat("3", [{ body: "Son del taller de jabones  ?", at: ago(3) }]);
    const d = await chat("4", [{ body: "¿Cuánto cuesta el taller del 15 de noviembre?", at: ago(24 * 5) }]);
    const e = await chat("5", [
      { body: "Mi pregunta es ,para el 15 de noviembre", at: ago(4) },
      { body: "El taller", at: ago(3.99) },
    ]);
    const f = await chat("6", [{ body: "¿cuánto cuesta la sanación con el dinero?", at: ago(5) }]);

    const first = await syncWorkshopInterests(forSync);
    const rows = (await listWorkshopInterests(edition.id)).filter((r) => ids.includes(r.conversationId));
    const rowA = rows.find((r) => r.conversationId === a);
    const rowC = rows.find((r) => r.conversationId === c);
    check("1. preguntó dos veces: una fila, 2 veces, con lo que escribió primero", rowA?.asks === 2 && rowA.firstMessage.startsWith("El costo del taller"), rowA);
    check("2. preguntó antes de crear el taller (botón de la página): entra", Boolean(rowC) && rowC?.status === "nuevo", rowC);
    check("3. otro taller y hace 5 días: no entran", !rows.some((r) => r.conversationId === b || r.conversationId === d), rows);
    check(
      "   la pregunta en dos mensajes y sin la palabra «taller» (el título): entran",
      rows.some((r) => r.conversationId === e) && rows.some((r) => r.conversationId === f),
      rows.map((r) => r.firstMessage)
    );
    check("   nombre y número del chat, sin llamada ni pago", rowA?.name === "Prueba Taller 1" && rowA.phone.endsWith("1") && !rowA.paid && rowA.nextCallAt === null, rowA);

    const again = await syncWorkshopInterests(forSync);
    const rowA2 = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === a);
    check("4. leer otra vez no suma nada", again.changed === 0 && rowA2?.asks === 2, { first, again, rowA2 });

    const ok = await setWorkshopInterestStatus(edition.id, rowA!.id, "contactada");
    const wrong = await setWorkshopInterestStatus("otra-edicion", rowA!.id, "descartada");
    const rowA3 = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === a);
    check("5. marcar «contactada»; otra edición no puede", ok && !wrong && rowA3?.status === "contactada", { ok, wrong, rowA3 });
  } finally {
    await prisma.$executeRaw`DELETE FROM workshop_interests WHERE edition_id = ${edition.id}`;
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await prisma.siteSetting.deleteMany({ where: { key: `workshop.interests.cursor.${edition.id}` } });
    await prisma.workshopEdition.delete({ where: { id: edition.id } });
    await prisma.$disconnect();
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(", ")}` : "\n✅ Todo bien");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
