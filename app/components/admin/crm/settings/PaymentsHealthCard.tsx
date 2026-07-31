import { Card, CardContent } from "@/app/components/ui/card";
import IntegrationHealthList from "./IntegrationHealthList";
import { getIntegrationHealth } from "@/lib/notifications/health";

/**
 * Solo lectura, a propósito: rotar una llave de PayPal o Mercado Pago sigue
 * siendo cambiar la variable de entorno y redesplegar (ver decisión de
 * alcance del plan) — esta pantalla dice si están puestas, no las edita.
 */
const PaymentsHealthCard = () => {
  const items = getIntegrationHealth().filter(
    (i) => i.id === "paypal" || i.id === "mercadopago"
  );

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Pasarelas de pago
          </h2>
          <p className="text-sm text-muted-foreground">
            Estado según las variables de entorno. Cambiar una llave sigue
            siendo un cambio de entorno y redeploy — no se edita desde aquí.
          </p>
        </div>
        <IntegrationHealthList items={items} />
      </CardContent>
    </Card>
  );
};

export default PaymentsHealthCard;
