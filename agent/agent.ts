import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { defineAgent } from "eve";

/**
 * Direct provider binding (not a gateway model id) — bypasses Vercel AI
 * Gateway entirely, so no `eve link`/`AI_GATEWAY_API_KEY` is needed. Uses
 * the same free-tier Google AI Studio key (GEMINI_API_KEY) this project
 * already used for the old contact/module-extraction feature.
 *
 * Went to NVIDIA NIM and back once already — that detour is worth
 * remembering: `gemini-3.5-flash-lite` (the model this project ran before)
 * turned out to be the actual problem, not Gemini itself. The lite tier
 * doesn't do the "thinking" pass Gemini's other models do, so the panel
 * never showed a reasoning/status trace, and NVIDIA's Llama vision models
 * don't have a thinking pass either — swapping providers didn't fix
 * that, it just moved the same symptom. `gemini-3.5-flash` (full, not
 * lite) fixes both complaints from one model: it accepts images and
 * produces real `thoughtsTokenCount` (both confirmed against a live
 * /v1beta generateContent call, including an actual image input). Still
 * free-tier despite Google pulling the Pro models off free access on
 * 2026-04-01 — that change didn't touch the Flash line.
 */
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

export default defineAgent({
  model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"),
  // Postdates this eve version's bundled AI Gateway model catalog, so eve
  // can't look up its context window on its own — this is the documented
  // escape hatch (see PublicAgentDefinition.modelContextWindowTokens).
  // 1,048,576 matches Google's reported inputTokenLimit for this model.
  modelContextWindowTokens: 1_048_576,
});
