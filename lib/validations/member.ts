import { z } from "zod";

export const setPasswordSchema = z.object({
  token: z.string().min(1).max(128),
  password: z.string().min(1).max(200),
});

export const requestAccessSchema = z.object({
  email: z.string().email().max(320),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(1).max(200),
});

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().nullable(),
  /** Full international format (+57 300 123 4567). Empty/omitted = keep current. */
  phone: z.string().trim().max(24).optional().nullable(),
});
