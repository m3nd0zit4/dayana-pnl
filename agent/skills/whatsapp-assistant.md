---
description: Cómo supervisar y configurar la IA que contesta el WhatsApp de Dayana. Úsala cuando pregunten cómo va WhatsApp, por qué la IA contestó o no a alguien, qué contestaría a algo, o cuando pidan cambiarle reglas, horarios de citas, duración de servicios, tono, o quién atiende un chat.
---

# La IA de WhatsApp

Además de ti, hay otra IA que contesta el WhatsApp de Dayana sola: informa,
agenda citas en su Google Calendar y le pasa a Dayana (sin contestar) los
pagos, lo que no sabe, los cambios de cita, las quejas y lo delicado. Tú la
supervisas y la configuras.

## Mirar

- `whatsapp_ai_status`: cómo le fue (24 h), si todo está conectado, y sus
  últimas decisiones con el motivo. Para «¿cómo te fue hoy?» o «¿por qué no le
  contestó a X?».
- `whatsapp_find_chat`: buscar un chat o ver las colas (`attention` = le toca a
  Dayana, `mine` = los tomó ella, `ai` = los lleva la IA).
- `whatsapp_get_config` y `whatsapp_list_playbooks`: cómo está configurada.
- `whatsapp_simulate_reply`: qué contestaría a un mensaje, sin enviar nada.

## Cambiar (Dayana aprueba cada cambio)

- Reglas de trato para una situación («cuando pregunten el precio, primero
  pregunta qué está viviendo») → `whatsapp_save_playbook`.
- Tono y forma general → `styleGuide`; cosas que debe saber o evitar →
  `instructions` (con `whatsapp_update_config`, reescribiendo el texto entero y
  conservando lo que ya había).
- Citas (servicios y duración, días y horas, respiro, antelación, Meet) →
  `booking` en `whatsapp_update_config`.
- Cuándo y a quién contesta, límites, a quién avisa, mensaje al pasar el chat
  (`escalation.holdingMessage`, vacío = silencio), modo de chats nuevos
  (`defaultMode`) → `whatsapp_update_config`.
- Un chat concreto (que lo atienda Dayana, copiloto, prioridad, reanudar la IA,
  corregir lo que recuerda de esa persona) → `whatsapp_set_chat`.
- Propuestas que la IA aprendió de las correcciones de Dayana → aparecen en
  `whatsapp_list_playbooks` con `source: learned`; se aprueban con
  `whatsapp_save_playbook` e `isEnabled: true`.

Después de cambiar una regla, pruébala con `whatsapp_simulate_reply` y
muéstrale a Dayana el resultado. Da siempre el enlace al chat
(`/admin/whatsapp?conversation=…`) cuando hables de uno.
