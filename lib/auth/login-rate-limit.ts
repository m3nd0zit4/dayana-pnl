import { rateLimit, rateLimitPeek } from "@/lib/api/rate-limit";

const emailKey = (email: string) => `login:email:${email.trim().toLowerCase()}`;
const ipKey = (ip: string) => `login:ip:${ip}`;

export const recordLoginFailure = (email: string, ip?: string) => {
  rateLimit(emailKey(email), 5, 15 * 60_000);
  if (ip) rateLimit(ipKey(ip), 20, 60 * 60_000);
};

export const isLoginRateLimited = (email: string, ip?: string): boolean => {
  if (!rateLimitPeek(emailKey(email), 5, 15 * 60_000).ok) return true;
  if (ip && !rateLimitPeek(ipKey(ip), 20, 60 * 60_000).ok) return true;
  return false;
};
