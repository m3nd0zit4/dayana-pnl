export const renderQuickMessage = (
  body: string,
  vars: Record<string, string>
): string => {
  let out = body;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
};
