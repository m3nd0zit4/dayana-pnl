/**
 * La IA nunca deja de responder (dueño, 21-oct): ninguna escalada la calla, ni
 * una crisis (la persona recibe apoyo y Dayana un aviso). Solo la pausa que
 * Dayana pone a mano («Pausar») la calla, y esa nunca se borra sola, ni si se
 * puso entre medio. Joselyn quedó 6 días sin respuesta por una escalada
 * «clinical» de su angustia, aunque Dayana encendió «La IA responde siempre».
 * Contra la base de DESARROLLO.
 *
 *   bun scripts/whatsapp-pause-crisis-e2e.ts
 */
export {};

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { liftPause, setAiAlways } = await import("@/lib/crm/whatsapp-autoreply");
  const { MANUAL_PAUSE_REASON } = await import("@/lib/crm/whatsapp-attention-rules");

  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database()::text AS db`;
  if (db !== "neondb_dev") throw new Error(`Solo contra neondb_dev (esta es ${db}).`);

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
    if (!ok) failures.push(name);
  };
  const run = Date.now();
  const ids: string[] = [];
  const paused = async (n: number, category: string | null, reason: string | null, severity: string | null = "normal") => {
    const c = await prisma.conversation.create({
      data: {
        channel: "WHATSAPP",
        externalThreadId: `5039${String(run).slice(-6)}${n}`,
        metaAccountId: "test-phone-id",
        participantName: "Prueba Pausa",
        aiPausedAt: new Date(),
        aiPausedReason: "escalation",
        escalationCategory: category,
        escalationSeverity: severity,
        escalationReason: reason,
      },
    });
    ids.push(c.id);
    return c;
  };
  const isPaused = async (id: string) => (await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { aiPausedAt: true } })).aiPausedAt !== null;

  try {
    console.log("\n1. Joselyn: angustia → «responde siempre» levanta la pausa");
    const joselyn = await paused(1, "clinical", "Joselyn pide que le quite la angustia por su hermana enferma y pregunta por una sesión gratis.");
    const r1 = await setAiAlways(joselyn.id, true, null);
    check("no queda en pausa", r1.stillPaused === false && !(await isPaused(joselyn.id)), r1);

    console.log("\n2. Una crisis tampoco calla a la IA (recibe apoyo; Dayana, el aviso)");
    const crisis = await paused(2, "clinical", "Dice que no quiere vivir más.", "urgent");
    const r2 = await setAiAlways(crisis.id, true, null);
    check("se levanta", r2.stillPaused === false && !(await isPaused(crisis.id)), r2);
    const crisis2 = await paused(3, "clinical", "Dice que no quiere vivir más.", "urgent");
    await liftPause(crisis2.id);
    check("y sin «responde siempre», el reloj la levanta igual", !(await isPaused(crisis2.id)));

    console.log("\n3. La pausa que Dayana puso a mano sigue");
    const byHand = await paused(4, "other", MANUAL_PAUSE_REASON);
    const r3 = await setAiAlways(byHand.id, true, null);
    check("«responde siempre» no la levanta", r3.stillPaused === true && (await isPaused(byHand.id)), r3);
    const byHand2 = await paused(5, null, null, null);
    await liftPause(byHand2.id);
    check("ni liftPause (puesta entre medio)", await isPaused(byHand2.id));
  } finally {
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(" · ")}` : "\n✅ La IA nunca deja de responder; solo «Pausar» la calla");
  await prisma.$disconnect();
  if (failures.length) process.exit(1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
