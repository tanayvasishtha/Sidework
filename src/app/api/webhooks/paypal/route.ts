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

  const event = (await req.json().catch(() => null)) as Parameters<typeof applyPayoutEvent>[1] | null;
  if (!event || typeof event !== "object") return Response.json({ error: "Expected a JSON event." }, { status: 400 });

  const verified = await verifyWebhook(paypal(), webhookId, req.headers, event).catch(() => false);
  if (!verified) return Response.json({ error: "PayPal didn't confirm this event." }, { status: 401 });

  // Unknown payouts still get a 200, or PayPal keeps retrying an event we'll never use.
  const applied = applyPayoutEvent(db(), event);
  return Response.json({ received: true, applied });
}
