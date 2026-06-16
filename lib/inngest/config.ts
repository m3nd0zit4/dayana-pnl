/** Both keys required for Inngest in production. */
export const isInngestConfigured = (): boolean =>
  Boolean(
    process.env.INNGEST_EVENT_KEY?.trim() &&
      process.env.INNGEST_SIGNING_KEY?.trim()
  );

export const assertInngestKeysPaired = (): void => {
  const eventKey = Boolean(process.env.INNGEST_EVENT_KEY?.trim());
  const signingKey = Boolean(process.env.INNGEST_SIGNING_KEY?.trim());
  if (eventKey !== signingKey) {
    throw new Error(
      "[inngest] INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY must both be set or both omitted"
    );
  }
};
