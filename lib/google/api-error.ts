/**
 * Errores de las APIs de Google, traducidos a algo accionable.
 *
 * El cuerpo de error de Google trae el motivo real (`accessNotConfigured`,
 * `insufficientPermissions`…), que es lo único con lo que se puede hacer algo;
 * el status por sí solo no distingue "no existe" de "te falta ese permiso".
 * Como el texto llega en inglés y acaba delante del operador, aquí se
 * reescriben los casos que tienen una salida concreta.
 */

export type GoogleApiId = "calendar" | "people" | "drive";

const API_META: Record<GoogleApiId, { label: string; service: string }> = {
  calendar: { label: "Google Calendar", service: "calendar-json.googleapis.com" },
  people: { label: "Google People (Contactos)", service: "people.googleapis.com" },
  drive: { label: "Google Drive", service: "drive.googleapis.com" },
};

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason?: string,
    /** Cierto cuando reintentar no puede funcionar sin que alguien cambie algo. */
    public readonly terminal = false
  ) {
    super(message);
  }
}

/** Google dice esto de una API que existe pero no está habilitada en el proyecto. */
const isApiDisabled = (reason: string | undefined, raw: string): boolean =>
  reason === "accessNotConfigured" ||
  reason === "SERVICE_DISABLED" ||
  /has not been used in project|is disabled/i.test(raw);

const projectFromMessage = (raw: string): string | null =>
  /project (\d{6,})/i.exec(raw)?.[1] ?? null;

/**
 * Construye el error final a partir de la respuesta de Google.
 *
 * Un `accessNotConfigured` se marca `terminal` a propósito: la API sigue
 * apagada por mucho que se reintente, y el agente tiene instrucciones de no
 * insistir con un fallo de configuración.
 */
export const toGoogleApiError = (
  api: GoogleApiId,
  status: number,
  rawMessage: string,
  reason?: string
): GoogleApiError => {
  const { label, service } = API_META[api];

  if (isApiDisabled(reason, rawMessage)) {
    const project = projectFromMessage(rawMessage);
    const url = `https://console.developers.google.com/apis/api/${service}/overview${
      project ? `?project=${project}` : ""
    }`;
    return new GoogleApiError(
      `La API de ${label} no está habilitada en el proyecto de Google Cloud${
        project ? ` (${project})` : ""
      }. Habilítala en ${url} y espera unos minutos a que propague. Reintentar sin habilitarla da el mismo error.`,
      status,
      reason ?? "accessNotConfigured",
      true
    );
  }

  if (status === 401 || reason === "authError") {
    return new GoogleApiError(
      `Google rechazó el permiso de esta cuenta para ${label}. Hay que reconectarla en /admin/ajustes/google.`,
      status,
      reason,
      true
    );
  }

  if (status === 403 && reason === "insufficientPermissions") {
    return new GoogleApiError(
      `Esta cuenta no concedió los permisos que ${label} necesita. Vuelve a conectarla en /admin/ajustes/google marcando el servicio.`,
      status,
      reason,
      true
    );
  }

  return new GoogleApiError(rawMessage || `${label} HTTP ${status}`, status, reason);
};

type GoogleErrorBody = {
  error?: {
    message?: string;
    status?: string;
    errors?: { reason?: string }[];
  };
};

/** Lee el cuerpo de error de Google y lanza el `GoogleApiError` que toque. */
export const throwGoogleApiError = async (
  api: GoogleApiId,
  res: Response
): Promise<never> => {
  const body = (await res.json().catch(() => ({}))) as GoogleErrorBody;
  throw toGoogleApiError(
    api,
    res.status,
    body.error?.message ?? "",
    body.error?.errors?.[0]?.reason ?? body.error?.status
  );
};
