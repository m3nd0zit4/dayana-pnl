import { defineAgent } from "eve";
import { AGENT_PROFILES } from "@/agent/lib/catalog";
import { geminiProvider } from "@/lib/ai/gemini";

const google = geminiProvider();

export default defineAgent({
  description: AGENT_PROFILES.agenda.description,
  model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"),
  modelContextWindowTokens: 1_048_576,
});
