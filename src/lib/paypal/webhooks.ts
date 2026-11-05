import type { PayPalClient } from "./client";

const HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * Asks PayPal whether a webhook really came from PayPal for our webhook id.
 * The event goes back as the exact text PayPal sent, because the signature covers
 * those bytes. Anything missing or unconfirmed counts as not verified.
 */
export async function verifyWebhook(
  client: PayPalClient,
  webhookId: string,
  headers: Headers,
  rawEvent: string,
): Promise<boolean> {
  const fields: Record<string, string> = {};
  for (const [field, header] of Object.entries(HEADERS)) {
    const value = headers.get(header);
    if (!value) return false;
    fields[field] = value;
  }
  const res = await client.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    rawBody: `${JSON.stringify({ ...fields, webhook_id: webhookId }).slice(0, -1)},"webhook_event":${rawEvent}}`,
  });
  return res.verification_status === "SUCCESS";
}
