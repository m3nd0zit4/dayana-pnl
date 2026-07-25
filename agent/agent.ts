import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { defineAgent } from "eve";

/**
 * Direct provider binding (not a gateway model id) — bypasses Vercel AI
 * Gateway entirely, so no `eve link`/`AI_GATEWAY_API_KEY` is needed. Uses
 * the same free-tier Google AI Studio key (GEMINI_API_KEY) this project
 * already used for the old contact/module-extraction feature.
 */
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

export default defineAgent({
  // "gemini-flash-lite-latest" (and the "gemini-2.5-flash-lite" generation it
  // pointed to) started 404ing for API keys created after Google restricted
  // it, ahead of its official Oct 2026 sunset — see
  // https://ai.google.dev/gemini-api/docs/deprecations. gemini-3.5-flash-lite
  // is the current stable flash-lite tier replacement.
  model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite"),
  // Postdates this eve version's bundled AI Gateway model catalog, so eve
  // can't look up its context window on its own — this is the documented
  // escape hatch (see PublicAgentDefinition.modelContextWindowTokens).
  // 1,048,576 matches Google's reported inputTokenLimit for this model.
  modelContextWindowTokens: 1_048_576,
});
