/**
 * eve only accepts plain JSON as a tool result («returned a non-JSON-serializable
 * result»). A Date, a BigInt or a Decimal slipping out of a Prisma row failed
 * the whole call — `get_conversation` failed on every chat with an open
 * window (its `expiresAt` is a Date) until 8-nov. Every CRM tool's output goes
 * through this in the dynamic resolvers: Dates become ISO strings, BigInts
 * numbers (strings past 2^53), undefined fields are dropped.
 */
export const plainJson = <T>(value: T): T =>
  value === undefined
    ? value
    : (JSON.parse(
        JSON.stringify(value, (_key, v: unknown) =>
          typeof v === "bigint" ? (Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()) : v
        )
      ) as T);
