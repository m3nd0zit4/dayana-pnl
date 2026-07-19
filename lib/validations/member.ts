import { z } from "zod";

export const setPasswordSchema = z.object({
  token: z.string().min(1).max(128),
  password: z.string().min(1).max(200),
});

export const requestAccessSchema = z.object({
  email: z.string().email().max(320),
  /** Optional display name, used to seed the contact on first signup. */
  name: z.string().trim().max(120).optional().nullable(),
  /**
   * Relative path to land on after the emailed link sets the password
   * (e.g. back to a workshop page). Must be a same-site path — "/x", never
   * "//host" or absolute URLs (open-redirect guard).
   */
  callbackUrl: z
    .string()
    .max(500)
    .regex(/^\/(?!\/)/)
    .optional()
    .nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(1).max(200),
});

/** Direct signup from the onboarding wizard — creates the account at once. */
export const signupSchema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().nullable(),
  /** Local mobile digits; country carried separately. */
  phone: z.string().trim().min(1).max(24),
  phoneCountry: z.string().trim().length(2),
  password: z.string().min(1).max(200),
  consentData: z.literal(true),
});

export const emailStatusSchema = z.object({
  email: z.string().email().max(320),
});

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().nullable(),
  /** Full international format (+57 300 123 4567). Empty/omitted = keep current. */
  phone: z.string().trim().max(24).optional().nullable(),
  workDescription: z.string().trim().max(80).optional().nullable(),
  themePreference: z.enum(["light", "dark", "system"]).optional(),
  preferredLocale: z.enum(["es", "en"]).optional(),
});

export const updateNotificationPrefsSchema = z.object({
  notifyEmail: z.boolean(),
  notifySms: z.boolean(),
  notifyWhatsapp: z.boolean(),
});
