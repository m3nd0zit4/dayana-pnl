import { z } from "zod";
import { type CountryCode } from "libphonenumber-js";
import { normalizePhoneWithCountry } from "@/lib/phone";

export const checkoutContactFieldsSchema = z
  .object({
    contactId: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1, "El teléfono es obligatorio."),
    phoneCountry: z
      .string()
      .trim()
      .length(2, "Selecciona un país.")
      .optional()
      .default("CO"),
    firstName: z.string().trim().max(120).optional(),
    lastName: z.string().trim().max(120).optional(),
    email: z
      .string()
      .trim()
      .min(1, "El correo es obligatorio.")
      .email("Introduce un correo válido.")
      .max(200),
    consentData: z.literal(true),
  })
  .superRefine((data, ctx) => {
    const country = (data.phoneCountry ?? "CO") as CountryCode;
    const normalized = normalizePhoneWithCountry(data.phone, country);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Por favor ingresa un número válido.",
      });
    }
  });

export type CheckoutContactFields = z.infer<typeof checkoutContactFieldsSchema>;

export const parseCheckoutContactFields = (
  input: unknown
):
  | { ok: true; data: CheckoutContactFields }
  | { ok: false; message: string; code: CheckoutContactFieldErrorCode } => {
  const result = checkoutContactFieldsSchema.safeParse(input);
  if (result.success) {
    return {
      ok: true,
      data: {
        ...result.data,
        email: result.data.email.toLowerCase(),
      },
    };
  }

  const issue = result.error.issues[0];
  const path = issue?.path[0];

  if (path === "email") {
    const msg = issue.message;
    return {
      ok: false,
      message: msg,
      code: msg.includes("obligatorio") ? "MISSING_EMAIL" : "INVALID_EMAIL",
    };
  }
  if (path === "phone") {
    const code =
      issue.message === "El teléfono es obligatorio."
        ? "MISSING_PHONE"
        : "INVALID_PHONE";
    return { ok: false, message: issue.message, code };
  }
  if (path === "consentData") {
    return {
      ok: false,
      message: "Debes aceptar el tratamiento de datos personales.",
      code: "CONSENT_REQUIRED",
    };
  }

  return {
    ok: false,
    message: issue?.message ?? "Datos de contacto inválidos.",
    code: "INVALID_CONTACT",
  };
};

export const lookupContactSchema = z.object({
  email: z.string().trim().email().max(200),
});

export type CheckoutContactFieldErrorCode =
  | "MISSING_EMAIL"
  | "INVALID_EMAIL"
  | "MISSING_PHONE"
  | "INVALID_PHONE"
  | "CONSENT_REQUIRED"
  | "INVALID_CONTACT";
