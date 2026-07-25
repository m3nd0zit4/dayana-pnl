/**
 * Some models occasionally double-escape newlines when composing tool-call
 * JSON (observed with ask_question prompts), producing the literal two
 * characters "\" + "n" in the string instead of a real line break — which
 * then renders as raw "\n" text in the panel instead of a line break or
 * space. Strip these before display so the operator never sees an escape
 * sequence leak through.
 */
export const sanitizePromptText = (text: string): string =>
  text
    .replace(/\\n+/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
