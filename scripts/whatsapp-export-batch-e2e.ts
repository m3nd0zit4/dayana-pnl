/**
 * Importar muchos chats del celular: lo personal no entra al CRM. Contra la
 * base de DESARROLLO, sin IA (las reglas solas: lo dudoso queda «revisar»).
 *
 *   bun scripts/whatsapp-export-batch-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Un chat de clienta se propone importar; uno de familia, no importar; uno
 *    sin señales, revisar.
 * 2. Marcar un número como personal: la vista previa lo dice, importarlo se
 *    rechaza y no queda ni un mensaje; en la tabla no está el número.
 * 3. La IA no le contestaría a ese número (`isIgnoredNumber`), en todas sus formas.
 * 4. Quitarlo de personales lo deja importar otra vez.
 */
import { prisma } from "@/lib/db";
import { ExportImportError, importExportChat, previewExportFiles } from "@/lib/crm/whatsapp-export-import";
import { ignoreNumbers, isIgnoredNumber, phoneHash, unignoreNumber } from "@/lib/crm/whatsapp-ignored-numbers";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
process.env.GEMINI_API_KEY = "";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const CLIENT = "+573000007711";
const FAMILY = "+573000007712";
const UNKNOWN = "+573000007713";
const THREADS = [CLIENT, FAMILY, UNKNOWN].map((p) => p.slice(1));

const file = (name: string, lines: string[]) => ({ fileName: `Chat de WhatsApp con ${name}.txt`, text: lines.join("\n") });

const CLIENT_CHAT = file(`Clienta ${CLIENT}`, [
  "02/05/26, 09:00 - Clienta: Hola Dayana, quiero agendar la llamada gratis",
  "02/05/26, 09:10 - Dayana Beltrán: Hola, te bendigo. ¿Qué día te sirve para la sesión?",
  "03/05/26, 18:00 - Clienta: Ya te mandé el comprobante de la transferencia del paquete",
]);
// Sin guardar en el celular: el archivo y el autor son el número.
const FAMILY_CHAT = file(FAMILY, [
  "05/05/26, 12:00 - +57 300 000 7712: Hija, ¿vienes el domingo al almuerzo?",
  "05/05/26, 12:30 - Dayana Beltrán: Sí mami, te amo. Llevo el postre para el almuerzo",
]);
const UNKNOWN_CHAT = file(`Sofía ${UNKNOWN}`, [
  "06/05/26, 08:00 - Sofía: Hola, ¿cómo vas?",
  "06/05/26, 08:05 - Dayana Beltrán: Muy bien, gracias. ¿Y tú?",
]);

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } },
    select: { id: true },
  });
  const ids = convs.map((c) => c.id);
  await prisma.whatsAppReplyExample.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  for (const p of [CLIENT, FAMILY, UNKNOWN]) await unignoreNumber(p);
};

const main = async () => {
  await cleanup();
  try {
    console.log("\n1. Qué se propone con cada chat");
    const [client, family, unknown] = await previewExportFiles([CLIENT_CHAT, FAMILY_CHAT, UNKNOWN_CHAT]);
    check("la clienta: importar", client.decision === "import" && client.classification.verdict === "business", client.classification);
    check("la familia: no importar", family.decision === "skip" && family.classification.verdict === "personal", family.classification);
    check("sin señales: revisar", unknown.decision === "review", unknown.classification);
    check("la vista previa no guardó nada", (await prisma.conversation.count({ where: { externalThreadId: { in: THREADS } } })) === 0);

    console.log("\n2. Número personal");
    await ignoreNumbers([FAMILY], "phone_export");
    const [again] = await previewExportFiles([FAMILY_CHAT]);
    check("la vista previa lo marca como personal", again.ignored && again.decision === "skip");
    let code: string | null = null;
    try {
      await importExportChat({ ...FAMILY_CHAT, phoneE164: FAMILY, dayanaAuthor: "Dayana Beltrán" });
    } catch (e) {
      code = e instanceof ExportImportError ? e.code : String(e);
    }
    check("importarlo se rechaza", code === "ignored_number", code);
    check("no quedó ni un mensaje", (await prisma.conversation.count({ where: { externalThreadId: FAMILY.slice(1) } })) === 0);
    const row = await prisma.whatsAppIgnoredNumber.findUnique({ where: { phoneHash: phoneHash(FAMILY)! } });
    check("en la tabla solo está la huella, no el número", Boolean(row) && !JSON.stringify(row).includes(FAMILY.slice(1)), row);

    console.log("\n3. La IA no le contestaría");
    check("por el número", await isIgnoredNumber(FAMILY.slice(1)));
    check("una clienta no está en la lista", !(await isIgnoredNumber(CLIENT.slice(1))));

    console.log("\n4. Quitarlo de personales");
    await unignoreNumber(FAMILY);
    const r = await importExportChat({ ...FAMILY_CHAT, phoneE164: FAMILY, dayanaAuthor: "Dayana Beltrán" });
    check("ahora sí se importa", r.stored === 2, r);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallos`);
    process.exit(1);
  }
  console.log("\n✅ Importar en tanda: todo bien");
};

main();
