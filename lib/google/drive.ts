import { throwGoogleApiError } from "./api-error";

/**
 * Google Drive, limitado a subir y compartir.
 *
 * El scope es `drive.file`, que solo alcanza lo que esta app crea. Eso es una
 * decisión, no una carencia: leer el Drive existente requiere
 * `drive.readonly`, que Google clasifica como *restringido* y obliga a la
 * evaluación de seguridad anual (CASA). Mientras esa decisión no se tome, aquí
 * solo se sube y se comparte lo que sale del propio CRM.
 */

const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  webContentLink?: string;
};

const parseError = (res: Response): Promise<never> =>
  throwGoogleApiError("drive", res);

/**
 * Sube un archivo con `multipart`: metadata y contenido en una sola petición.
 * Para lo que sube el CRM (PDFs, imágenes, notas) es suficiente; el modo
 * `resumable` solo compensa a partir de archivos grandes.
 */
export const uploadFile = async (
  token: string,
  input: {
    name: string;
    mimeType: string;
    content: Buffer | Uint8Array | string;
    /** Carpeta destino; sin ella el archivo cae en la raíz de la cuenta. */
    parentFolderId?: string;
  }
): Promise<DriveFile> => {
  const boundary = `dayana-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: input.name,
    ...(input.parentFolderId ? { parents: [input.parentFolderId] } : {}),
  });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`
    ),
    Buffer.isBuffer(input.content)
      ? input.content
      : Buffer.from(input.content as Uint8Array | string),
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,name,mimeType,webViewLink,webContentLink",
  });

  const res = await fetch(`${UPLOAD_BASE}?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) return parseError(res);
  return (await res.json()) as DriveFile;
};

/**
 * Deja el archivo accesible por enlace.
 *
 * `anyoneWithLink` es lo que hace útil un enlace pegado en WhatsApp o en un
 * correo, pero también significa que quien lo reenvíe lo abre igual. No usar
 * para nada clínico ni con datos personales de un contacto.
 */
export const shareFileWithLink = async (
  token: string,
  fileId: string
): Promise<void> => {
  const res = await fetch(
    `${DRIVE_BASE}/${encodeURIComponent(fileId)}/permissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    }
  );

  if (!res.ok) await parseError(res);
};

/**
 * Lista únicamente los archivos que esta app subió — es todo lo que
 * `drive.file` puede ver. Si el operador espera su Drive completo, no es esto.
 */
export const listAppFiles = async (
  token: string,
  pageSize = 25
): Promise<DriveFile[]> => {
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    orderBy: "createdTime desc",
    fields: "files(id,name,mimeType,webViewLink,webContentLink)",
  });

  const res = await fetch(`${DRIVE_BASE}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return parseError(res);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
};
