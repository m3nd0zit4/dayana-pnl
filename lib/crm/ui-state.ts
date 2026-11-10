import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Small per-user UI state (`StaffUiState`) that should follow a staff member
 * from the phone to the computer, such as the contact search recents.
 */

/** The only keys a client may read or write. */
export const UI_STATE_KEYS = ["contact-search-recents"] as const;
export type UiStateKey = (typeof UI_STATE_KEYS)[number];
export const isUiStateKey = (key: string): key is UiStateKey => (UI_STATE_KEYS as readonly string[]).includes(key);

const UI_STATE_MAX_BYTES = 20_000;

export const getUiState = async (staffUserId: string, key: UiStateKey): Promise<unknown> =>
  (await prisma.staffUiState.findUnique({ where: { staffUserId_key: { staffUserId, key } }, select: { value: true } }))?.value ??
  null;

export const setUiState = async (staffUserId: string, key: UiStateKey, value: unknown): Promise<boolean> => {
  if (Buffer.byteLength(JSON.stringify(value)) > UI_STATE_MAX_BYTES) return false;
  const json = value as Prisma.InputJsonValue;
  await prisma.staffUiState.upsert({
    where: { staffUserId_key: { staffUserId, key } },
    create: { staffUserId, key, value: json },
    update: { value: json },
  });
  return true;
};
