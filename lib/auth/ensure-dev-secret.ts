/**
 * Auth.js exige AUTH_SECRET en el middleware (edge).
 * En desarrollo local, un fallback evita bloquear /admin/sign-in antes de configurar .env.
 */
if (
  process.env.NODE_ENV === "development" &&
  !process.env.AUTH_SECRET
) {
  process.env.AUTH_SECRET = "dev-only-auth-secret-replace-in-env";
}
