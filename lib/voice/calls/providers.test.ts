import { describe, expect, test } from "bun:test";
import { CallNotConfiguredError, CallProviderError, fakeCalls, fakeProvider, providerFor, twilioProvider, whatsAppCallRequest, whatsAppProvider } from "./providers";
import { callClosingTwiml, callOpeningTwiml, escapeXml } from "./twiml";

const req = { to: "+573001234567", message: "Laura pagó 190.000 por Nequi. ¿La registro?", callKey: "k3y_abcdefgh", baseUrl: "https://www.dayanabeltran.com/" };

type Captured = { url: string; init?: RequestInit };
const capture = (response: Response) => {
  const calls: Captured[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return response.clone();
  };
  return { calls, fetchImpl };
};

describe("twiml", () => {
  test("escapes XML so a message can't inject TwiML", () => {
    expect(escapeXml(`<Dial>+1</Dial> & "x"`)).toBe("&lt;Dial&gt;+1&lt;/Dial&gt; &amp; &quot;x&quot;");
    const xml = callOpeningTwiml({ message: "<Play>evil</Play>", gatherUrl: "https://x/a?c=1&s=gather", voice: { voice: "V", language: "es-MX" } });
    expect(xml).not.toContain("<Play>");
    expect(xml).toContain('action="https://x/a?c=1&amp;s=gather"');
    expect(xml).toContain('<Gather input="speech" language="es-CO"');
  });

  test("closing says where the answer went and hangs up", () => {
    expect(callClosingTwiml("sí, regístralo", { voice: "V", language: "es-MX" })).toContain("te lo dejo en el panel");
    expect(callClosingTwiml(null, { voice: "V", language: "es-MX" })).toContain("No te escuché");
    expect(callClosingTwiml(null)).toContain("<Hangup/>");
  });
});

describe("fake provider", () => {
  test("rings nobody and returns an id", async () => {
    const before = fakeCalls.length;
    const placed = await fakeProvider().place(req);
    expect(placed).toEqual({ providerCallId: "fake-k3y_abcdefgh", status: "simulated" });
    expect(fakeCalls.length).toBe(before + 1);
    expect(providerFor("fake").missing()).toEqual([]);
  });
});

describe("twilio provider (option B)", () => {
  const env = { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok", TWILIO_VOICE_FROM_NUMBER: "+15550001111" };

  test("names what is missing, never values; refuses to call", async () => {
    const p = twilioProvider({ TWILIO_ACCOUNT_SID: "AC123" });
    expect(p.missing()).toEqual(["TWILIO_AUTH_TOKEN", "TWILIO_VOICE_FROM_NUMBER"]);
    await expect(p.place(req)).rejects.toBeInstanceOf(CallNotConfiguredError);
  });

  test("falls back to the SMS sender number when there is no voice one", () => {
    expect(twilioProvider({ TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: "b", TWILIO_FROM_NUMBER: "+1555" }).missing()).toEqual([]);
  });

  test("POSTs Calls.json with Basic auth, TwiML and the signed-webhook URLs", async () => {
    const { calls, fetchImpl } = capture(new Response(JSON.stringify({ sid: "CA999", status: "queued" }), { status: 201 }));
    const placed = await twilioProvider(env, fetchImpl).place(req);
    expect(placed).toEqual({ providerCallId: "CA999", status: "queued" });
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123:tok").toString("base64")}`);
    const form = new URLSearchParams(String(calls[0].init?.body));
    expect(form.get("To")).toBe("+573001234567");
    expect(form.get("From")).toBe("+15550001111");
    expect(form.get("Twiml")).toContain("Laura pagó 190.000 por Nequi");
    expect(form.get("Twiml")).toContain("https://www.dayanabeltran.com/api/webhooks/twilio/agent-call?c=k3y_abcdefgh&amp;s=gather");
    expect(form.get("StatusCallback")).toBe("https://www.dayanabeltran.com/api/webhooks/twilio/agent-call?c=k3y_abcdefgh&s=status");
    expect(form.get("MachineDetection")).toBe("Enable");
  });

  test("a Twilio error becomes a readable error", async () => {
    const { fetchImpl } = capture(new Response(JSON.stringify({ code: 21215, message: "Geo permission" }), { status: 400 }));
    await expect(twilioProvider(env, fetchImpl).place(req)).rejects.toThrow(CallProviderError);
    await expect(twilioProvider(env, fetchImpl).place(req)).rejects.toThrow("código 21215");
  });
});

describe("whatsapp provider (option A)", () => {
  const env = { WHATSAPP_CALLING_PHONE_NUMBER_ID: "1234", WHATSAPP_CALLING_TOKEN: "t", AGENT_CALL_MEDIA_BRIDGE_URL: "https://bridge.example/" };

  test("request shape for a business-initiated call", () => {
    expect(whatsAppCallRequest({ phoneNumberId: "1234", to: "+57 300 123 4567", sdpOffer: "v=0" })).toEqual({
      path: "1234/calls",
      body: { messaging_product: "whatsapp", to: "573001234567", action: "connect", session: { sdp_type: "offer", sdp: "v=0" } },
    });
  });

  test("needs a number, a token and a media bridge", () => {
    expect(whatsAppProvider({}).missing()).toEqual(["WHATSAPP_CALLING_PHONE_NUMBER_ID", "WHATSAPP_CALLING_TOKEN", "AGENT_CALL_MEDIA_BRIDGE_URL"]);
  });

  test("asks the bridge for an SDP offer, then calls Meta with it", async () => {
    const seen: Captured[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return url.startsWith("https://bridge.example")
        ? new Response(JSON.stringify({ sdp: "v=0 offer" }), { status: 200 })
        : new Response(JSON.stringify({ calls: [{ id: "wacid.1" }] }), { status: 200 });
    };
    const placed = await whatsAppProvider(env, fetchImpl).place(req);
    expect(placed.providerCallId).toBe("wacid.1");
    expect(seen[0].url).toBe("https://bridge.example/sessions");
    expect(seen[1].url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/1234\/calls$/);
    expect(JSON.parse(String(seen[1].init?.body)).session.sdp).toBe("v=0 offer");
  });

  test("no SDP from the bridge → no call to Meta", async () => {
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 502 });
    };
    await expect(whatsAppProvider(env, fetchImpl).place(req)).rejects.toThrow("oferta SDP");
    expect(seen).toEqual(["https://bridge.example/sessions"]);
  });
});
