# Modelo de datos CRM — Dayana Beltrán PNL

## Principios

- **3NF** en entidades core; snapshots de precio/sesiones en `Enrollment` y `Payment`.
- **Un contacto** por `phone_e164` (E.164 internacional).
- **Varios servicios** = varias filas `Enrollment` por `Contact`.
- **Máximo 1 terapia `ACTIVE`** por contacto (validado en `lib/crm/enrollments.ts`).
- Pagos `APPROVED` vía webhook o alta `MANUAL` en admin.

## Entidades principales

| Entidad | Rol |
|---------|-----|
| `Contact` | Persona (cliente internacional) |
| `Product` / `ProductPrice` | Catálogo (terapia, curso, taller) |
| `Enrollment` | Contrato / inscripción de un servicio |
| `Payment` | Cobro real (PayPal, Mercado Pago, manual) |
| `TherapyPackage` / `TherapySession` | Operación 1:1 |
| `WorkshopEdition` | Ediciones de talleres |
| `StaffUser` / `AuditLog` | Operadores del CRM |
| `MessageTemplate` / `MessageLog` | Comunicación asistida |
| `Tag` / `ContactTag` | Segmentación |

## Flujo de pago

1. Checkout crea `Enrollment` `PENDING_PAYMENT` → `external_reference` = `enrollmentId`.
2. Webhook aprueba → `Payment` + `Enrollment.ACTIVE` + `TherapyPackage` si aplica.
3. `/pago/exito` captura contacto (nombre, teléfono, consentimiento).

## Auth CRM

- NextAuth (credenciales email + contraseña) en `/admin` y `/api/admin`.
- `StaffUser` con `password_hash` (bcrypt).
- Roles: `OWNER`, `OPERATOR`, `READONLY`, `DEVELOPER`.
- Sin registro público: altas de staff vía seed o script/admin OWNER.

## Automatización (Fase 6)

- Inngest emite eventos tras pagos y recordatorios de sesión.
- WhatsApp sigue siendo principalmente `wa.me` hasta volumen que justifique Meta API.
