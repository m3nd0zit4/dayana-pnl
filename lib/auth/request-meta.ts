import { headers } from "next/headers";

export const readRequestMeta = async () => {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    ipAddress:
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null,
  };
};
