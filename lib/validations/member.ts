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
