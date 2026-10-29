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
 * Anything missing or unconfirmed counts as not verified.
 */
export async function verifyWebhook(
  client: PayPalClient,
  webhookId: string,
  headers: Headers,
  event: unknown,
): Promise<boolean> {
  const fields: Record<string, string> = {};
  for (const [field, header] of Object.entries(HEADERS)) {
    const value = headers.get(header);
    if (!value) return false;
    fields[field] = value;
  }
  const res = await client.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    body: { ...fields, webhook_id: webhookId, webhook_event: event },
  });
  return res.verification_status === "SUCCESS";
}
