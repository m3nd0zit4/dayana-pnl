# Caso para soporte de PayPal — habilitar el pago sin cuenta

> Borrador para que Julián lo envíe desde la cuenta de negocio.
> Estado: **pendiente de enviar**.

## Qué pedimos

Habilitar **"Pago como usuario no registrado"** (guest checkout / PayPal Account
Optional) en la cuenta de negocio `DayanaBeltran`, o confirmar por escrito que
no está disponible para comercios en Colombia.

## Por qué importa

Las clientas que no tienen cuenta de PayPal no pueden completar la compra:
PayPal les muestra la pantalla de acceso y no una de tarjeta. Es venta perdida
en el rail internacional, que es el único que atiende a todo el mundo fuera de
Colombia (las compradoras colombianas van por Mercado Pago).

## Evidencia recogida el 19/08/2026

1. En **Configuración → Preferencias del sitio web**, "Pago como usuario no
   registrado" figura en **Desactivado**.
2. Al cambiarlo a **Activado**, la interfaz muestra el mensaje "Guardado".
3. La petición `PUT /unifiedsettings/api/v1/updateWebsitePreferences` responde
   **HTTP 200**, y la propia telemetría de PayPal registra el evento
   `unifiedsettings_website_preferences_update_website_preferences_api_successful`.
4. **Al recargar la página el valor vuelve a Desactivado.** Repetido tres veces,
   mismo resultado.
5. **No es un fallo general de la pantalla**: en la misma sesión sí se guardaron
   y persistieron *Configuración de Pagos Exprés → Activado*, *Número de
   teléfono de contacto → Activado (campo opcional)* y la *URL de retorno* del
   redireccionamiento automático. Sólo esta opción concreta rebota.

## Cómo está integrado el checkout

- API **Orders v2**, órdenes creadas en servidor con
  `payment_source.paypal.experience_context`.
- Se solicita explícitamente **`landing_page: "GUEST_CHECKOUT"`**, es decir, ya
  pedimos la pantalla de tarjeta en lugar del acceso.
- Flujo por redirección al enlace `payer-action`; no se usa el SDK incrustado.
- Webhook activo sobre `PAYMENT.CAPTURE.*` y `CHECKOUT.ORDER.*`.

## Preguntas concretas

1. ¿Está disponible el pago sin cuenta de PayPal para una cuenta de negocio con
   país de residencia **Colombia**?
2. Si no lo está, ¿qué alternativa ofrece PayPal para que una compradora sin
   cuenta pueda pagar con tarjeta a este comercio?
3. ¿Es elegible esta cuenta para **Expanded/Advanced Checkout** (campos de
   tarjeta alojados)? Si no, ¿por qué motivo?
