# Notificaciones (correo, SMS, WhatsApp)

## Correo (recomendado: Resend + dayanabeltran.com)

Guía paso a paso con dominio en Vercel: **`docs/vercel-resend-email.md`**

```env
NOTIFICATIONS_ENABLED=true
NOTIFICATIONS_DRY_RUN=false
NOTIFICATIONS_EMAIL_FROM=contacto@dayanabeltran.com
NOTIFICATIONS_EMAIL_FROM_NAME=Dayana Beltrán PNL
RESEND_API_KEY=re_...
```

Si `RESEND_API_KEY` está definida, se usa Resend. Si no, se usa SMTP (Gmail) como respaldo.

### Gmail temporal (solo pruebas)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu@gmail.com
SMTP_PASS=contraseña-de-aplicación
```

## SMS (Twilio) y WhatsApp (Meta)

Opcional. Ver `.env.example`.

## Inngest

`docs/inngest-setup.md` — campañas grandes y cron.

## CRM

- **Notificaciones** — correo de prueba a ti misma.
- **Talleres** → megáfono — aviso masivo por correo.
