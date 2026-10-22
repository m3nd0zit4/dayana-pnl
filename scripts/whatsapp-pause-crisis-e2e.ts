/**
 * Una escalada «clinical» que no es crisis no calla a la IA (Joselyn, 21-oct:
 * su angustia por su hermana enferma la dejó 6 días sin respuesta, aunque
 * Dayana encendió «La IA responde siempre»). Una crisis de verdad sí, y una
 * crisis escrita entre medio nunca se borra. Contra la base de DESARROLLO.
 *
 *   bun scripts/whatsapp-pause-crisis-e2e.ts
 */
export {};

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { liftPause, setAiAlways } = await import("@/lib/crm/whatsapp-autoreply");

  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database()::text AS db`;
  if (db !== "neondb_dev") throw new Error(`Solo contra neondb_dev (esta es ${db}).`);

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
    if (!ok) failures.push(name);
  };
  const run = Date.now();
  const ids: string[] = [];
  const paused = async (n: number, reason: string, severity = "normal") => {
    const c = await prisma.conversation.create({
      data: {
        channel: "WHATSAPP",
        externalThreadId: `5039${String(run).slice(-6)}${n}`,
        metaAccountId: "test-phone-id",
        participantName: "Prueba Pausa",
        aiPausedAt: new Date(),
        aiPausedReason: "escalation",
        escalationCategory: "clinical",
        escalationSeverity: severity,
        escalationReason: reason,
      },
    });
    ids.push(c.id);
    return c;
  };
  const state = (id: string) => prisma.conversation.findUniqueOrThrow({ where: { id }, select: { aiPausedAt: true, escalationReason: true } });

  try {
    console.log("\n1. Joselyn: angustia, sin riesgo → «responde siempre» levanta la pausa");
    const joselyn = await paused(1, "Joselyn pide que le quite la angustia por su hermana enferma y pregunta por una sesión gratis.");
    const r1 = await setAiAlways(joselyn.id, true, null);
    check("no queda en pausa", r1.stillPaused === false, r1);
    check("la pausa se levantó en la base", (await state(joselyn.id)).aiPausedAt === null);

    console.log("\n2. Una crisis de verdad sigue en pausa");
    const crisis = await paused(2, "Dice que no quiere vivir más.");
    const r2 = await setAiAlways(crisis.id, true, null);
    check("sigue en pausa", r2.stillPaused === true && (await state(crisis.id)).aiPausedAt !== null, r2);

    console.log("\n3. Leída como no crisis, pero entre medio se escribió una crisis: no se borra");
    const raced = await paused(3, "Cuenta que tiene ansiedad.");
    const seen = { category: "clinical", severity: "normal", reason: "Cuenta que tiene ansiedad." };
    await prisma.conversation.update({ where: { id: raced.id }, data: { escalationReason: "Habla de quitarse la vida." } });
    await liftPause(raced.id, { keepCrisis: "any", seen });
    check("la crisis nueva sigue en pausa", (await state(raced.id)).aiPausedAt !== null);
  } finally {
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(" · ")}` : "\n✅ Solo una crisis de verdad calla a la IA");
  await prisma.$disconnect();
  if (failures.length) process.exit(1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
