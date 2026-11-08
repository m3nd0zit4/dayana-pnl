/**
 * iPhone/Safari solo deja hablar si la primera frase sale de un toque: se
 * llama dentro del clic (encender el modo voz, o el botón «Modo voz» de la
 * pastilla del teléfono) con una frase vacía y muda.
 */
export const unlockSpeechSynthesis = () => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* sin voz: el modo voz lo dirá */
  }
};
