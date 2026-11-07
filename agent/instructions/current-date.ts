import { defineDynamic, defineInstructions } from "eve/instructions";
import { currentDateMarkdown } from "@/agent/lib/current-date";

export default defineDynamic({
  events: {
    "turn.started": () => defineInstructions({ markdown: currentDateMarkdown() }),
  },
});
