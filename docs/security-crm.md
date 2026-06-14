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
  - **OPERATOR**: escritura CRM + pagos manuales + cuaderno clínico
  - **DEVELOPER**: escritura sin cuaderno clínico ni pagos manuales
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

## Cuaderno clínico (ContactNotebookPage)

| Dato | Almacenamiento |
|------|----------------|
| Trazos Excalidraw | `canvasData` (JSON) en Postgres |
| Miniatura PNG | Vercel Blob `contacts/{contactId}/notebook/{pageId}/preview-*.png` |
| Hojas UPLOAD (PDF/imagen) | Blob `contacts/{contactId}/notebook/{pageId}/upload-*` |

**Acceso:** lectura con cualquier rol staff autenticado; escritura solo `OWNER` y `OPERATOR` (`canEditClinicalNotes`). `READONLY` ve el lienzo en modo lectura.

**Auditoría:** CREATE / UPDATE / DELETE de hojas en `fireAuditLog` (entidad `ContactNotebookPage`).

**Borrado:** al eliminar una hoja se borran blobs de `previewUrl` y `attachmentUrl` asociados.

**Retención:** sin caducidad automática; borrado manual por staff con permiso de escritura.

**Producción:** requiere Vercel Blob conectado al proyecto (OIDC: `BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN`) o `BLOB_READ_WRITE_TOKEN` fuera de Vercel; sin Blob el dibujo (JSON) sigue guardándose.
