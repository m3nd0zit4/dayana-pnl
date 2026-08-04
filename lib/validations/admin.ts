import { z } from "zod";

export const deleteContactSchema = z.object({
  /** The phone (real contacts) or full name (placeholder-phone leads —
   *  Google/email signups with no captured number yet) shown for the staff
   *  member to retype as a delete confirmation. */
  confirm: z.string().min(1).max(120),
});

export const createStaffSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(12).max(200),
  displayName: z.string().min(1).max(120),
  role: z
    .enum(["OWNER", "OPERATOR", "READONLY", "DEVELOPER"])
    .optional()
    .default("OPERATOR"),
});

export const manualPaymentSchema = z.object({
  enrollmentId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().min(3).max(3),
  reference: z.string().max(120).optional(),
  providerPaymentId: z.string().max(120).optional(),
  code: z.string().min(4).max(8),
});

export const requestPaymentOtpSchema = z.object({
  enrollmentId: z.string().min(1),
});

export const broadcastSchema = z.object({
  templateKey: z.string().min(1).max(80).default("workshop_open"),
  name: z.string().min(1).max(120).default("Campaña CRM"),
  audience: z.enum(["ALL_CONTACTS", "MARKETING_CONSENT"]).default("ALL_CONTACTS"),
  channels: z.array(z.enum(["EMAIL", "SMS", "WHATSAPP"])).optional(),
  workshopEditionId: z.string().optional(),
  runNow: z.boolean().optional(),
});

export const testEmailSchema = z.object({
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  to: z.string().email().max(200).optional(),
});

export const createContactSchema = z.object({
  phone: z.string().min(6).max(30),
  // Not mandatory — plenty of real contacts start as "we have the number,
  // not the name" (a WhatsApp lead, a walk-in). Phone is still the one
  // required identifying field; see upsertContactByPhone's displayName
  // fallback (shows the phone itself, not a fake placeholder name) for how
  // a nameless contact renders everywhere else in the CRM.
  firstName: z.string().max(120).optional().nullable(),
  lastName: z.string().max(120).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  phoneCountry: z.string().max(4).optional(),
  countryIso: z.string().max(4).optional(),
  timezone: z.string().max(80).optional(),
  preferredLocale: z.string().max(10).optional(),
  source: z
    .enum([
      "WEB",
      "WHATSAPP_DIRECT",
      "TIKTOK",
      "INSTAGRAM",
      "YOUTUBE",
      "REFERRAL",
      "OTHER",
    ])
    .optional(),
  sourceDetail: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  consentData: z.boolean().optional(),
  consentMarketing: z.boolean().optional(),
});

export const createNotebookPageSchema = z.object({
  title: z.string().max(120).optional(),
  kind: z.enum(["CANVAS", "UPLOAD"]).optional(),
  background: z.enum(["BLANK", "RULED", "GRID"]).optional(),
  therapySessionId: z.string().min(1).optional().nullable(),
  enrollmentId: z.string().min(1).optional().nullable(),
});

export const updateNotebookPageSchema = z.object({
  title: z.string().max(120).optional().nullable(),
  background: z.enum(["BLANK", "RULED", "GRID"]).optional(),
  canvasData: z.unknown().optional().nullable(),
  bodyText: z.string().max(5000).optional().nullable(),
  therapySessionId: z.string().min(1).optional().nullable(),
  enrollmentId: z.string().min(1).optional().nullable(),
  attachmentUrl: z.string().url().optional().nullable(),
  attachmentMime: z.string().max(120).optional().nullable(),
  attachmentName: z.string().max(200).optional().nullable(),
});

export const reorderNotebookPagesSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

export const createEnrollmentSchema = z.object({
  contactId: z.string().min(1),
  productId: z.string().min(1),
  workshopEditionId: z.string().optional(),
  status: z
    .enum([
      "LEAD",
      "PENDING_PAYMENT",
      "ACTIVE",
      "COMPLETED",
      "CANCELLED",
    ])
    .optional(),
  label: z.string().max(120).optional(),
});

const workshopScheduleSlotSchema = z.object({
  startTime: z.string().min(1).max(20),
  endTime: z.string().min(1).max(20),
  title: z.string().min(1).max(500),
  time: z.string().max(120).optional(),
});

export const workshopEditionSchema = z.object({
  slug: z.string().min(1).max(120).optional(),
  title: z.string().min(1).max(200),
  editionLabel: z.string().max(120).optional().nullable(),
  cardSummary: z.string().max(5000).optional().nullable(),
  status: z
    .enum(["DRAFT", "OPEN", "CLOSED", "COMPLETED"])
    .optional(),
  dateLabel: z.string().max(200).optional().nullable(),
  scheduleLabel: z.string().max(200).optional().nullable(),
  capacity: z.number().int().min(0).optional().nullable(),
  whatsappTemplate: z.string().max(5000).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  productId: z.string().optional().nullable(),
  heroLine1: z.string().max(200).optional().nullable(),
  heroLine2: z.string().max(200).optional().nullable(),
  heroLine3: z.string().max(200).optional().nullable(),
  detailSummary: z.string().max(5000).optional().nullable(),
  intro: z.string().max(5000).optional().nullable(),
  focusTopics: z.array(z.string().min(1).max(500)).optional().nullable(),
  daySchedule: z.array(workshopScheduleSlotSchema).optional().nullable(),
  topicsSectionTitle: z.string().max(200).optional().nullable(),
  topicsSectionDescription: z.string().max(5000).optional().nullable(),
  scheduleSectionDescription: z.string().max(5000).optional().nullable(),
  metaTitle: z.string().max(200).optional().nullable(),
  metaDescription: z.string().max(500).optional().nullable(),
  introOpen: z.string().max(5000).optional().nullable(),
});

export const courseModuleSchema = z.object({
  title: z.string().min(1).max(200),
  bodyMd: z.string().max(100_000).optional().nullable(),
  isPublished: z.boolean().optional(),
});

export const reorderCourseModulesSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

const quizOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(300),
  correct: z.boolean(),
});
const quizQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1).max(500),
  options: z
    .array(quizOptionSchema)
    .min(2)
    .max(8)
    .refine((opts) => opts.some((o) => o.correct), "Cada pregunta necesita una respuesta correcta"),
});
export const quizJsonSchema = z.object({
  questions: z.array(quizQuestionSchema).min(1).max(50),
});

export const liveClassSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  meetUrl: z.string().url().max(500).optional().nullable(),
  recordingUrl: z.string().url().max(1000).optional().nullable(),
  moduleId: z.string().min(1).optional().nullable(),
  contentType: z.enum(["VIDEO", "TEXT", "PDF", "QUIZ"]).optional(),
  bodyMd: z.string().max(20000).optional().nullable(),
  quizJson: quizJsonSchema.optional().nullable(),
});

export const reorderCourseClassesSchema = z.object({
  moduleId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
});

export const assignClassModuleSchema = z.object({
  moduleId: z.string().min(1).nullable(),
});

export const membershipPaidUntilSchema = z.object({
  paidUntil: z.string().datetime().nullable(),
});

export const updateStaffSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["OWNER", "OPERATOR", "READONLY", "DEVELOPER"]).optional(),
  isActive: z.boolean().optional(),
});

export const updateStaffProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  themePreference: z.enum(["light", "dark", "system"]).optional(),
});

export const updateStaffNotificationPrefsSchema = z.object({
  notifyEmail: z.boolean(),
});
