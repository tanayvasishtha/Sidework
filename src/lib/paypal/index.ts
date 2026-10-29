import { join } from "node:path";
import { replayFetch } from "@/lib/replay";
import { settings } from "@/lib/settings";
import { type PayPalClient, createPayPalClient } from "./client";

export * from "./client";
export * from "./money";
export * from "./payouts";
export * from "./webhooks";

let shared: PayPalClient | undefined;

/** Each live payout batch needs a fresh id, so recordings are matched without it. */
export function withoutBatchId(_url: string, body: unknown): unknown {
  if (!body || typeof body !== "object" || !("sender_batch_header" in body)) return body;
  const typed = body as { sender_batch_header: Record<string, unknown> };
  const header = { ...typed.sender_batch_header };
  delete header.sender_batch_id;
  return { ...typed, sender_batch_header: header };
}

/** The app's PayPal client. With no keys it answers from recorded sandbox responses. */
export function paypal(): PayPalClient {
  const s = settings();
  if (s.paypalMode !== "replay" && (!s.PAYPAL_CLIENT_ID || !s.PAYPAL_CLIENT_SECRET)) {
    throw new Error("PayPal keys are not set. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.local.");
  }
  shared ??= createPayPalClient({
    baseUrl: s.PAYPAL_API_BASE,
    clientId: s.PAYPAL_CLIENT_ID ?? "replay",
    clientSecret: s.PAYPAL_CLIENT_SECRET ?? "replay",
    fetch: replayFetch({ mode: s.paypalMode, dir: join(s.FIXTURES_DIR, "paypal"), keyBody: withoutBatchId }),
  });
  return shared;
}
