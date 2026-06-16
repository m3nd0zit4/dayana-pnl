# Inngest (CRM Dayana)

Automatizaciones: post-pago, recordatorios de sesión, campañas masivas.

## Variables (ambas obligatorias en Production)

```env
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

Sin **ambas** claves, la app falla al arrancar en Vercel Production. No configures solo una.

## Desarrollo local

1. Cuenta en [Inngest](https://www.inngest.com) → copia claves al `.env`.
2. `bun dev`
3. `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`

## Producción

1. Variables en Vercel Production.
2. Dashboard Inngest → sync `https://dayanabeltran.com/api/inngest`

## Flujos

| Evento | Función |
|--------|---------|
| `payment/approved` | Correo confirmación post-pago |
| `notification/campaign.run` | Broadcast >10 contactos |
| Cron diario | Recordatorios de sesión |

Definidas en `lib/inngest/functions.ts`.
