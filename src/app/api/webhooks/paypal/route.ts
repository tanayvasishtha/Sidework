import { db } from "@/lib/db";
import { applyPayoutEvent } from "@/lib/pay";
import { paypal, verifyWebhook } from "@/lib/paypal";
import { settings } from "@/lib/settings";

// PayPal calls this as each payout moves: sent, claimed, unclaimed, returned.
export async function POST(req: Request): Promise<Response> {
  const webhookId = settings().PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    return Response.json({ error: "PAYPAL_WEBHOOK_ID isn't set, so events can't be verified." }, { status: 503 });
  }

  const raw = await req.text();
  let event: Parameters<typeof applyPayoutEvent>[1] | null = null;
  try {
    event = JSON.parse(raw);
  } catch {
    // Handled just below.
  }
  if (!event || typeof event !== "object") return Response.json({ error: "Expected a JSON event." }, { status: 400 });

  let verified = false;
  try {
    verified = await verifyWebhook(paypal(), webhookId, req.headers, raw);
  } catch {
    // PayPal unreachable or misconfigured: treated as unverified, and PayPal will retry.
  }
  if (!verified) return Response.json({ error: "PayPal didn't confirm this event." }, { status: 401 });

  // Unknown payouts still get a 200, or PayPal keeps retrying an event we'll never use.
  const applied = applyPayoutEvent(db(), event);
  return Response.json({ received: true, applied });
}
