import { get, put } from "@vercel/blob";

/**
 * Canvas scenes live as private JSON blobs; Postgres keeps only the pointer
 * (`canvasUrl`). Paths are timestamped (never overwritten) because Blob's edge
 * cache serves overwritten paths stale for up to a minute.
 */
export const saveCanvasSceneToBlob = async (
  contactId: string,
  pageId: string,
  serialized: string
): Promise<string> => {
  const path = `contacts/${contactId}/notebook/${pageId}/canvas-${Date.now()}.json`;
  const blob = await put(path, serialized, {
    access: "private",
    contentType: "application/json",
  });
  return blob.url;
};

export const loadCanvasSceneFromBlob = async (
  url: string
): Promise<unknown | null> => {
  try {
    const access = url.includes(".private.blob.vercel-storage.com")
      ? ("private" as const)
      : ("public" as const);
    const result = await get(url, { access });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};
