import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

/**
 * Direct provider binding (not a gateway model id) — bypasses Vercel AI
 * Gateway entirely, so no `eve link`/`AI_GATEWAY_API_KEY` is needed. NVIDIA's
 * NIM catalog (build.nvidia.com) exposes an OpenAI-compatible chat
 * completions API at integrate.api.nvidia.com, free-tier, keyed by
 * NVIDIA_API_KEY.
 */
const nvidia = createOpenAICompatible({
  name: "nvidia",
  apiKey: process.env.NVIDIA_API_KEY?.trim(),
  baseURL: "https://integrate.api.nvidia.com/v1",
});

export default defineAgent({
  // The prior gemini-3.5-flash-lite pick didn't take image/file attachments
  // in this project's usage. llama-4-maverick-17b-128e-instruct was tried
  // first (NVIDIA's larger MoE flagship) but its catalog entry hit end-of-life
  // on 2026-07-27 (410 Gone) — confirmed live against /v1/models before
  // settling on this one. llama-3.2-90b-vision-instruct is the largest
  // vision-instruct model NVIDIA currently serves (verified against a live
  // /v1/chat/completions call, including an actual image input), chosen over
  // the smaller 11b tier specifically so the panel's file/image attach menu
  // works.
  model: nvidia(process.env.NVIDIA_MODEL?.trim() || "meta/llama-3.2-90b-vision-instruct"),
  // Postdates this eve version's bundled AI Gateway model catalog (it's a
  // direct NVIDIA NIM binding, not a gateway model id) — same escape hatch
  // the prior Google binding needed. 131,072 matches Meta's reported context
  // window for this model. See PublicAgentDefinition.modelContextWindowTokens.
  modelContextWindowTokens: 131_072,
});
