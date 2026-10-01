import { describe, expect, test } from "bun:test";

import type { SendEmailInput, SendEmailResult } from "./channels/email";
import { notifyWebinarRegistration } from "./lead-notify";

/**
 * `confirmationSent` decide si `/api/leads` sella `linkEmailSentAt`. Si dice
 * «sí» sin que el enlace saliera, esa persona se queda sin enlace y fuera de
 * la cola del fan-out.
 */

const MEET = "https://meet.google.com/abc-defg-hij";

const input = {
  firstName: "Ana",
  phoneE164: "+573000000000",
  email: "ana@example.com",
  meetUrl: MEET,
  scheduleLabel: "domingo 4 de octubre",
  eventTitle: "Sanar la relación",
};

/** Un `sendEmail` falso: guarda a quién se envió y puede fallar con el de la inscrita. */
const fakeSend = (opts: { failTo?: string } = {}) => {
  const sent: string[] = [];
  const send = async (m: SendEmailInput): Promise<SendEmailResult> => {
    if (m.to === opts.failTo) throw new Error("Resend error: 500");
    sent.push(m.to);
    return { providerId: "test" };
  };
  return { send, sent };
};

describe("notifyWebinarRegistration — confirmationSent", () => {
  test("salió la confirmación con el enlace: true", async () => {
    const { send, sent } = fakeSend();
    expect(await notifyWebinarRegistration(input, send)).toEqual({ confirmationSent: true });
    expect(sent).toContain("ana@example.com");
  });

  test("el envío a la inscrita falló: false (antes se sellaba igual)", async () => {
    const { send } = fakeSend({ failTo: "ana@example.com" });
    expect(await notifyWebinarRegistration(input, send)).toEqual({ confirmationSent: false });
  });

  test("todavía sin enlace de Meet: la confirmación no cuenta como el correo del enlace", async () => {
    const { send, sent } = fakeSend();
    expect(await notifyWebinarRegistration({ ...input, meetUrl: null }, send)).toEqual({
      confirmationSent: false,
    });
    expect(sent).toContain("ana@example.com");
  });

  test("sin correo: false", async () => {
    const { send } = fakeSend();
    expect(await notifyWebinarRegistration({ ...input, email: null }, send)).toEqual({
      confirmationSent: false,
    });
  });

  test("si falla el aviso a Dayana, la confirmación sigue saliendo", async () => {
    const { send, sent } = fakeSend({ failTo: "admin-inbox@example.com" });
    const prev = process.env.NOTIFICATIONS_LEAD_TO;
    process.env.NOTIFICATIONS_LEAD_TO = "admin-inbox@example.com";
    try {
      expect(await notifyWebinarRegistration(input, send)).toEqual({ confirmationSent: true });
      expect(sent).toEqual(["ana@example.com"]);
    } finally {
      if (prev === undefined) delete process.env.NOTIFICATIONS_LEAD_TO;
      else process.env.NOTIFICATIONS_LEAD_TO = prev;
    }
  });
});
