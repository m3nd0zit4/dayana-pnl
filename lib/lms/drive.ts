/**
 * Google Drive helpers — class recordings are Drive links pasted by staff
 * (Meet saves recordings to the organizer's Drive automatically).
 */

const FILE_PATH_RE = /\/file\/d\/([A-Za-z0-9_-]{10,})/;
const ID_PARAM_RE = /[?&]id=([A-Za-z0-9_-]{10,})/;

export const extractDriveFileId = (url: string): string | null => {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const byPath = FILE_PATH_RE.exec(trimmed);
  if (byPath) return byPath[1];
  const byParam = ID_PARAM_RE.exec(trimmed);
  if (byParam) return byParam[1];
  return null;
};

export const isDriveFileUrl = (url: string): boolean =>
  extractDriveFileId(url) !== null;

/** Embeddable player URL for an iframe. */
export const drivePreviewUrl = (url: string): string | null => {
  const id = extractDriveFileId(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
};
