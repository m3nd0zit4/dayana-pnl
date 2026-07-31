import { emailFrom, emailProviderId } from "../config";
import { resolveDryRun } from "../platform/resolve";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type SendEmailResult = {
  providerId: string;
  messageId?: string;
};

const sendViaResend = async (
  input: SendEmailInput
): Promise<SendEmailResult> => {
  const key = process.env.RESEND_API_KEY!.trim();
  const from = emailFrom();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${from.name} <${from.email}>`,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: input.headers,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { id?: string };
  return { providerId: "resend", messageId: data.id };
};

const sendViaSmtp = async (
  input: SendEmailInput
): Promise<SendEmailResult> => {
  const nodemailer = await import("nodemailer");
  const from = emailFrom();
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASS!.trim(),
    },
  });

  const info = await transporter.sendMail({
    from: `${from.name} <${from.email}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: input.headers,
  });

  return { providerId: "smtp", messageId: info.messageId };
};

export const sendEmail = async (
  input: SendEmailInput
): Promise<SendEmailResult> => {
  if (await resolveDryRun()) {
    console.info("[notifications:dry-run] email", {
      to: input.to,
      subject: input.subject,
    });
    return { providerId: "dry-run" };
  }

  const provider = emailProviderId();
  if (!provider) {
    throw new Error(
      "Email no configurado: define RESEND_API_KEY o SMTP_HOST/SMTP_USER/SMTP_PASS"
    );
  }

  if (provider === "resend") return sendViaResend(input);
  return sendViaSmtp(input);
};

/** Resend/SMTP care about undefined vs. absent differently — this always yields a plain object. */
export const buildUnsubscribeHeaders = (unsubscribeUrl: string): Record<string, string> => ({
  "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${emailFrom().email}?subject=unsubscribe>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});
