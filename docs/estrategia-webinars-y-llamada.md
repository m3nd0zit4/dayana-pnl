# Estrategia: la llamada 1 a 1, los webinars gratuitos y los talleres

## La oferta (una sola puerta)

Dayana vende un modelo **híbrido**: primero acompaña a la persona a salir de lo
que la tiene mal (agotamiento, tristeza, ansiedad, falta de rumbo) y después a
crecer (su negocio, su marca personal, su contenido, sus clientes, un propósito).

La página `/llamada` presenta **toda** la oferta y tiene **una sola acción**:
agendar la sesión 1 a 1 gratis. La venta **no** se hace en la página: se cierra
en la llamada, donde Dayana escucha y propone lo que esa persona necesita
(sesiones 1 a 1, un taller, la mensualidad del curso, o una combinación).
Por eso en la página no hay precios ni botones de pago.

Las preguntas del formulario le dan a Dayana, antes de llamar:
cómo se siente hoy, a dónde quiere llegar, para cuándo, si está en disposición
de invertir en su proceso, a qué se dedica y sus redes. Todo queda en la ficha
del contacto y en «Embudo» del CRM.

## Webinars gratuitos: botón extra, nunca en lugar de la llamada

Cuando hay un evento gratuito **abierto** en el CRM (`/admin/eventos`,
publicado), `/llamada` muestra solo un recuadro extra «Evento gratuito en vivo
· Inscribirme gratis», dos veces: debajo del botón principal y debajo del
formulario («¿Prefieres empezar por algo en grupo?»). Lleva a la página del
evento con `?ref=llamada`. Cuando el evento se cierra, el recuadro desaparece
solo. No hay que tocar código.

El recuadro es más discreto que el botón de la llamada a propósito: quien está
lista para hablar con Dayana no debe desviarse a un evento.

Flujo recomendado para cada webinar:

1. **Antes (1–2 semanas):** reels y anuncios que llevan a la página del evento.
   En `/enlaces` y en `/llamada` aparece solo el botón del evento.
2. **Durante:** al final del webinar, la invitación es una sola: «agenda tu
   sesión 1 a 1 gratis» → `/llamada?ref=webinar`. Dayana puede decirlo en voz y
   dejar el enlace en el chat del Meet.
3. **Después (24–48 h):** el recordatorio por WhatsApp a quienes se inscribieron
   lleva a `/llamada?ref=webinar` (no a pagar). En «Embudo» se ve cuántos
   agendaron desde el webinar por el canal y la campaña.

## Talleres: se cierran en la llamada

Si hay un taller abierto **no** se le pone botón de pago en `/llamada`. El
taller es una de las cosas que Dayana puede proponer en la llamada. La
pregunta frecuente «¿Y los talleres?» lo dice así. El registro de interés del
taller sigue existiendo en `/enlaces` como hasta ahora.

## Qué medir (CRM → Embudo)

- Cuántas personas dejan sus datos, responden, agendan, confirman y hablan.
- De dónde llegan (`?ref=` y campañas `utm_campaign`): reels, anuncios,
  webinar, enlaces.
- Quién dejó sus datos y no agendó: a esas personas se les escribe el mismo día.

## Material pendiente para la página

Los espacios están en `lib/content/llamada-landing.ts`. En local y en las
vistas previas se ven como recuadros «Video pendiente / Foto pendiente» con lo
que hay que grabar; en producción, un espacio sin archivo no se muestra.

| Espacio | Qué es |
|---|---|
| Video principal | Dayana a cámara, 2–4 min: a quién le habla, su historia, el método (sanar → crecer), qué pasa en la llamada, invitación. |
| Testimonios en video | Ya salen los 6 primeros testimonios reales de YouTube (los de `/historias`). Los nuevos se agregan en `VIDEO_TESTIMONIALS` con nombre y su cambio en una línea. |
| Foto de la comunidad | Foto de grupo real (clase, taller, encuentro). |
| Historia destacada | Foto de una persona + título + una o dos frases. |
| Capturas de mensajes | 3 capturas de WhatsApp/Instagram con permiso y sin números visibles. |
| Foto de Dayana | Ya hay una real; se puede cambiar. |
