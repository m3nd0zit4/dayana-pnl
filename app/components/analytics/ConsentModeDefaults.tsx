import Script from "next/script";
import { CONSENT_STORAGE_KEY } from "../../../lib/cookies/consent";

/**
 * Consent Mode v2: valores por defecto.
 *
 * Tiene que ejecutarse ANTES de que cargue el contenedor de GTM — si llega
 * después, las etiquetas ya dispararon sin restricción y el "denied" no sirve
 * de nada. De ahí `beforeInteractive`, que lo inyecta en el HTML inicial.
 *
 * El bloque también relee la decisión guardada y la aplica de inmediato: sin
 * eso, un visitante que ya aceptó volvería a empezar en "denied" en cada carga
 * y perderíamos la medición hasta que React hidratara.
 */
const ConsentModeDefaults = () => (
  <Script id="consent-mode-defaults" strategy="beforeInteractive">
    {`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{
  ad_storage:'denied',
  ad_user_data:'denied',
  ad_personalization:'denied',
  analytics_storage:'denied',
  personalization_storage:'denied',
  functionality_storage:'granted',
  security_storage:'granted',
  wait_for_update:500
});
try{
  var stored = window.localStorage.getItem(${JSON.stringify(CONSENT_STORAGE_KEY)});
  if(stored){
    var c = JSON.parse(stored);
    gtag('consent','update',{
      analytics_storage: c.analytics ? 'granted' : 'denied',
      ad_storage: c.marketing ? 'granted' : 'denied',
      ad_user_data: c.marketing ? 'granted' : 'denied',
      ad_personalization: c.marketing ? 'granted' : 'denied'
    });
  }
}catch(e){}
`}
  </Script>
);

export default ConsentModeDefaults;
