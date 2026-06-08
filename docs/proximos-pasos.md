# Próximos pasos — CRM Dayana Beltrán

Orden sugerido después de tener correo (Resend) funcionando.

## 1. Producción (Vercel)

- [ ] Variables en **Vercel → Settings → Environment Variables** (mismas que `.env`): `RESEND_API_KEY`, `NOTIFICATIONS_*`, `DATABASE_URL`, pagos, `AUTH_SECRET`.
- [ ] `NOTIFICATIONS_DRY_RUN=false` solo en Production.
- [ ] Redeploy del sitio.

## 2. Correo

- [x] Dominio `dayanabeltran.com` en Resend + DNS en Vercel.
- [ ] Probar de nuevo: `bun run email:sample tu@correo.com`
- [ ] Hacer un pago de prueba real (sandbox o monto bajo) y confirmar que llega el correo automático al cliente.

## 3. Webhooks de pago (recomendado)

| Proveedor | URL | Variable opcional |
|-----------|-----|-------------------|
| Mercado Pago | `https://dayanabeltran.com/api/webhooks/mercadopago` | `MERCADOPAGO_WEBHOOK_SECRET` |
| PayPal | `https://dayanabeltran.com/api/webhooks/paypal` | `PAYPAL_WEBHOOK_ID` |

Sin webhook de MP, el CRM puede no pasar a **Activo** aunque el cliente haya pagado (PayPal suele actualizar vía `capture-order`).

## 4. Inngest (opcional, campañas y cron)

- [ ] Cuenta [inngest.com](https://www.inngest.com) → claves en `.env` y Vercel.
- [ ] Producción: registrar `https://dayanabeltran.com/api/inngest`.
- [ ] Local: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`

Sirve para: confirmación post-pago en segundo plano, recordatorios de sesión, campañas grandes a muchos contactos.

## 5. Operación diaria del CRM

1. **Contactos** — teléfono E.164 y email cuando exista.
2. **Mensajes rápidos** — tus textos para copiar en WhatsApp (ya no salen las plantillas del sistema).
3. **Talleres** → megáfono → aviso masivo por correo.
4. **Notificaciones** → redactar y **Enviarme este correo** para revisar antes de enviar a todos.
5. **Terapias** — agendar sesiones y Meet.

## 6. Más adelante (no urgente)

- WhatsApp Business API (`WHATSAPP_*` en `.env`).
- SMS Twilio (`TWILIO_*`).
- Buzón real `contacto@dayanabeltran.com` (Workspace o reenvío) si quieres **leer** respuestas en ese alias.

## Comandos útiles

```bash
bun run db:migrate:deploy   # migraciones
bun run db:seed             # usuario OWNER
bun run email:sample        # correo de ejemplo
bun dev                     # panel local /admin
```
