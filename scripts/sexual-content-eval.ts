/**
 * Evaluación del filtro de contenido sexual del TEXTO (lo que no es
 * inequívoco lo decide Gemini). Corre cada caso k veces y falla si alguno no
 * acierta las k (un falso positivo borra el chat de alguien que pedía ayuda).
 *
 *   GEMINI_SCREEN_MODEL=gemini-3.5-flash bun --env-file=../dayana-pnl/.env scripts/sexual-content-eval.ts [--k 3]
 *
 * No toca la base ni manda nada.
 */
import { classifySexualText } from "@/lib/crm/whatsapp-agent/content-screen";
import { SEXUAL_TEXT_CASES } from "@/lib/crm/whatsapp-agent/eval/sexual-content-cases";
import { explicitSexualText, sexualHint, textVerdictBlocks } from "@/lib/crm/whatsapp-agent/sexual-content-rules";

const k = Number(process.argv[process.argv.indexOf("--k") + 1]) || 3;

const decide = async (text: string, previous: string[]): Promise<{ block: boolean; how: string }> => {
  const rule = explicitSexualText(text);
  if (rule) return { block: true, how: `regla:${rule}` };
  if (!sexualHint(text)) return { block: false, how: "sin palabras" };
  const v = await classifySexualText(text, previous);
  return { block: textVerdictBlocks(v), how: v ? `modelo:${v.kind}:${v.confidence}` : "modelo:sin respuesta" };
};

let failed = 0;
for (const c of SEXUAL_TEXT_CASES) {
  const runs = [];
  for (let i = 0; i < k; i++) runs.push(await decide(c.text, c.previous ?? []));
  const ok = runs.filter((r) => r.block === c.block).length;
  const pass = ok === k;
  if (!pass) failed++;
  console.log(`${pass ? "✅" : "❌"} ${c.id} (${c.block ? "bloquear" : "no bloquear"}) ${ok}/${k} · ${runs.map((r) => r.how).join(" | ")}`);
}
console.log(failed ? `\n❌ ${failed} casos fallaron` : "\n✅ Todos los casos");
process.exit(failed ? 1 : 0);
