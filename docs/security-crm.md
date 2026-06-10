# Seguridad CRM — Dayana PNL

Guía operativa del panel staff (`/admin`).

## Autenticación

| Concepto | Valor |
|----------|-------|
| Ruta de login | `/admin/sign-in` |
| API Auth | `/api/auth/[...nextauth]` (NextAuth v5, credenciales) |
| Sign-up público | **No.** Solo OWNER crea usuarios en `/admin/team` |
| Duración de sesión | **30 días** por dispositivo |
| Cookie | `authjs.session-token` (dev) / `__Secure-authjs.session-token` (prod) |

### Variables obligatorias en producción

```env
AUTH_SECRET=          # openssl rand -base64 32
DATABASE_URL=
DIRECT_URL=
MERCADOPAGO_WEBHOOK_SECRET=
PAYPAL_WEBHOOK_ID=
```

**Nunca** definir `CRM_UI_PREVIEW=true` en producción.

### Rate limit de login

- 5 intentos fallidos por email / 15 min
- 20 intentos por IP / hora

## Sesiones activas

Las sesiones de staff se registran en base de datos (30 días, revocables al cerrar sesión). No hay panel en el CRM para gestionarlas desde Equipo.

Al desactivar un usuario (`isActive = false`), pierde acceso en el siguiente request.

## APIs admin

- Protegidas por `proxy.ts` + `resolveAdminStaff()` en cada handler
- Sin sesión: **401** `{ error: "UNAUTHORIZED" }`
- Mutaciones: verificación de `Origin`/`Referer` (CSRF básico)
- RBAC:
  - **OWNER**: equipo, productos, broadcast, test-email
  - **OPERATOR**: escritura CRM + pagos manuales + notas clínicas
  - **DEVELOPER**: escritura sin notas clínicas ni pagos manuales
  - **READONLY**: solo lectura

## Webhooks de pago

En producción los webhooks **se rechazan** si faltan secretos. PayPal usa la API `verify-webhook-signature`.

## Rate limit distribuido (opcional)

Para límites consistentes en Vercel serverless:

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Sin Upstash, el fallback es rate limit en memoria (solo dev / instancia única).

## Runbook — cuenta comprometida

1. En `/admin/team`, desactivar el usuario afectado (o pedir a OWNER).
2. OWNER: **Cerrar otras sesiones** en Equipo (o revocar todas vía API).
3. Rotar `AUTH_SECRET` fuerza re-login global (último recurso).
4. Revisar `/admin/audit` (LOGIN_FAILED, SESSION_REVOKED, STAFF_CREATED).
5. Cambiar contraseña del staff (vía seed/DB hasta existir UI de cambio).

## Adjuntos de notas clínicas

La vista previa pasa por `/api/admin/contacts/.../attachment` (requiere sesión staff). El SDK actual de Vercel Blob solo permite `access: public`; no exponer URLs fuera del CRM.
