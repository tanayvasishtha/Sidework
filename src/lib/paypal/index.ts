import { join } from "node:path";
import { replayFetch } from "@/lib/replay";
import { settings } from "@/lib/settings";
import { type PayPalClient, createPayPalClient } from "./client";

export * from "./client";
export * from "./money";
export * from "./payouts";

let shared: PayPalClient | undefined;

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
    fetch: replayFetch({ mode: s.paypalMode, dir: join(s.FIXTURES_DIR, "paypal") }),
  });
  return shared;
}
