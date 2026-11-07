const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Solo método y cabeceras: `mcp-handler` añade `auth?: AuthInfo` al `Request`
// global y eso choca con el `auth` de NextAuth en proxy.ts.
export const verifyAdminMutationOrigin = (req: Pick<Request, "method" | "headers">): boolean => {
  if (!MUTATING.has(req.method.toUpperCase())) return true;

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (!host) return false;

  const expected = new Set([
    `https://${host}`,
    `http://${host}`,
  ]);

  if (origin) {
    try {
      const o = new URL(origin);
      return expected.has(`${o.protocol}//${o.host}`);
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const r = new URL(referer);
      return expected.has(`${r.protocol}//${r.host}`);
    } catch {
      return false;
    }
  }

  return process.env.NODE_ENV === "development";
};
