import { describe, expect, it } from "vitest";
import { createPayPalClient } from "./client";
import { verifyWebhook } from "./webhooks";

const headers = new Headers({
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-11-07T06:58:00Z",
});

function client(status: string, seen: unknown[] = []) {
  return createPayPalClient({
    baseUrl: "https://api-m.sandbox.paypal.com",
    clientId: "id",
    clientSecret: "s",
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).endsWith("/oauth2/token")) return Response.json({ access_token: "t", expires_in: 32400 });
      seen.push(JSON.parse(String(init.body)));
      return Response.json({ verification_status: status });
    }) as typeof fetch,
  });
}

describe("verifyWebhook", () => {
  it("sends PayPal's headers, our webhook id and the event to be checked", async () => {
    const seen: unknown[] = [];
    const event = { id: "WH-1", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" };
    await expect(verifyWebhook(client("SUCCESS", seen), "WEBHOOK-ID", headers, event)).resolves.toBe(true);
    expect(seen[0]).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
      transmission_id: "tx-1",
      transmission_sig: "sig",
      transmission_time: "2026-11-07T06:58:00Z",
      webhook_id: "WEBHOOK-ID",
      webhook_event: event,
    });
  });

  it("rejects what PayPal won't confirm, and requests missing PayPal's headers", async () => {
    await expect(verifyWebhook(client("FAILURE"), "W", headers, {})).resolves.toBe(false);
    await expect(verifyWebhook(client("SUCCESS"), "W", new Headers(), {})).resolves.toBe(false);
  });
});
