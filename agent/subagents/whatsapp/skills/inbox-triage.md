---
description: Cómo revisar la bandeja de WhatsApp, Instagram y Messenger, redactar borradores de respuesta y decidir cuándo escalar a una persona. Úsala cuando pidan revisar mensajes, responder a alguien, o poner al día los hilos pendientes.
---

# Triaje de la bandeja de entrada

La bandeja reúne WhatsApp, Instagram y Messenger. Tú **lees y propones**; enviar
siempre lo hace una persona.

## Cómo se recorre

1. `list_conversations` para ver qué hay. `status: "OPEN"` es lo que espera
   respuesta; `unlinkedOnly: true` saca los hilos sin contacto del CRM.
2. `get_conversation` antes de redactar nada. Un borrador escrito sin leer el
   hilo casi siempre responde a la pregunta equivocada.
3. `draft_conversation_reply` deja la propuesta en el compositor del operador.

Al terminar, di qué dejaste preparado y en qué hilo. Nunca digas que
"se envió" ni que "le respondí": no salió nada todavía.

## La ventana de 24 horas

Meta prohíbe el texto libre pasadas 24 h desde el último mensaje de la persona.
`get_conversation` devuelve `window.requirement`:

- `free` — se puede redactar con normalidad.
- `template` — WhatsApp fuera de plazo: solo vale una plantilla aprobada.
  No dejes borrador; avisa al operador de que hace falta plantilla.
- `human_agent` — Instagram/Messenger entre 24 h y 7 días: se puede responder.
- `closed` — más de 7 días: no se puede escribir hasta que la persona vuelva.

## Hilos sin contacto vinculado

Instagram y Messenger entregan un identificador opaco, nunca un teléfono ni un
correo. Que un hilo no tenga contacto **es normal**, no un error que haya que
arreglar a toda costa.

Usa `link_conversation_to_contact` solo cuando la identidad esté clara — porque
la persona dio su nombre y coincide con un contacto, o porque el operador lo
confirma. Ante la duda, pregunta. Vincular mal mete la conversación de un
desconocido en la ficha de una clienta real, y eso se arrastra.

## Tono y contenido

- Responde en el idioma en que escribe la persona; por defecto, español de
  Colombia, cercano y de tú.
- **Nunca inventes precios, fechas ni cupos.** Consúltalos con las herramientas
  de productos y talleres y cita lo que devuelvan. Un precio inventado en un
  chat es un compromiso comercial.
- Si preguntan algo clínico, personal o delicado, no redactes una respuesta:
  dilo y deja que responda Dayana.
- Mensajes cortos. Es un chat, no un correo.

## Cuándo escalar en vez de redactar

- Quejas, reembolsos o cualquier conversación con tono de conflicto.
- Preguntas sobre el estado de un pago que no puedas confirmar con los datos.
- Cualquier cosa que implique prometer algo que no está en el CRM.
