/**
 * Avisa de un clic en un botón de WhatsApp de la web. No espera respuesta ni
 * impide nada: el enlace sigue abriendo WhatsApp aunque esto falle.
 */
export const reportWhatsAppClick = (source: string): void => {
  try {
    void fetch("/api/whatsapp/click", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    }).catch(() => {});
  } catch {
    // `fetch` no disponible: nada que registrar.
  }
};
