import { describe, expect, it } from "vitest";
import { takeOut } from "@/lib/closeout";
import { openDb, SATURDAY } from "@/lib/db";
import { createPayPalClient } from "@/lib/paypal";
import { applyPayoutEvent, getNightPayout, PayRefusedError, payNight, refreshPayout } from "./pay";

const SANDBOX = "https://api-m.sandbox.paypal.com";

type Sent = {
  sender_batch_header: { sender_batch_id: string };
  items: { sender_item_id: string; receiver: string; recipient_wallet: string; amount: { value: string }; note: string }[];
};

/** A stand-in for the sandbox: accepts batches and reports every item with the given status. */
function fakeSandbox(itemStatus = "SUCCESS") {
  const batches: Sent[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "t", expires_in: 32400 });
    if (url.pathname === "/v1/payments/payouts" && init.method === "POST") {
      batches.push(JSON.parse(String(init.body)) as Sent);
      return Response.json({ batch_header: { payout_batch_id: `PB${batches.length}`, batch_status: "PENDING" } }, { status: 201 });
    }
    const m = /^\/v1\/payments\/payouts\/PB(\d+)$/.exec(url.pathname);
    if (m) {
      const sent = batches[Number(m[1]) - 1];
      return Response.json({
        batch_header: { payout_batch_id: `PB${m[1]}`, batch_status: "SUCCESS" },
        items: sent.items.map((it, i) => ({
          payout_item_id: `ITEM${i}`,
          transaction_status: itemStatus,
          payout_item: {
            sender_item_id: it.sender_item_id,
            recipient_wallet: it.recipient_wallet,
            amount: { currency: "USD", value: it.amount.value },
          },
        })),
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { batches, client: createPayPalClient({ baseUrl: SANDBOX, clientId: "id", clientSecret: "s", fetch: f }) };
}

function readyNight() {
  const d = openDb(":memory:");
  takeOut(d, SATURDAY, "dave", "FLSA-MGR");
  return d;
}

describe("payNight", () => {
  it("won't pay while Dave is still in the pool", async () => {
    const { client, batches } = fakeSandbox();
    await expect(payNight(openDb(":memory:"), SATURDAY, client, { baseUrl: SANDBOX })).rejects.toThrow(PayRefusedError);
    expect(batches).toHaveLength(0);
  });

  it("pays everyone their share in one batch, Venmo or PayPal", async () => {
    const d = readyNight();
    const { client, batches } = fakeSandbox();
    const payout = await payNight(d, SATURDAY, client, { baseUrl: SANDBOX });

    expect(batches).toHaveLength(1);
    const sent = batches[0];
    expect(sent.items).toHaveLength(13);
    expect(sent.items.find((i) => i.sender_item_id.endsWith(":maria"))).toMatchObject({
      recipient_wallet: "VENMO",
      receiver: "maria@sidework.test",
      note: "Your tips from Lucia's, Saturday, Nov 7",
    });
    expect(sent.items.find((i) => i.sender_item_id.endsWith(":omar"))?.recipient_wallet).toBe("PAYPAL");

    const sentCents = sent.items.reduce((t, i) => t + Math.round(Number(i.amount.value) * 100), 0);
    expect(sentCents).toBe(payout.items.reduce((t, i) => t + i.cents, 0));
    expect(payout.paypalBatchId).toBe("PB1");
    expect(payout.items.every((i) => i.status === "SUCCESS")).toBe(true);

    const saved = d.prepare("select sum(tip_cents) as cents, count(*) as n from allocations where night_id = ?").get(SATURDAY) as {
      cents: number;
      n: number;
    };
    expect(saved).toEqual({ cents: sentCents, n: 13 });
  });

  it("pays a night only once", async () => {
    const d = readyNight();
    const { client, batches } = fakeSandbox();
    await payNight(d, SATURDAY, client, { baseUrl: SANDBOX });
    await expect(payNight(d, SATURDAY, client, { baseUrl: SANDBOX })).rejects.toThrow("already been sent");
    expect(batches).toHaveLength(1);
  });

  it("refuses anything but the sandbox", async () => {
    const { client } = fakeSandbox();
    await expect(payNight(readyNight(), SATURDAY, client, { baseUrl: "https://api-m.paypal.com" })).rejects.toThrow("sandbox");
  });

  it("sends test payouts to stand-in sandbox accounts when set", async () => {
    const { client, batches } = fakeSandbox();
    await payNight(readyNight(), SATURDAY, client, {
      baseUrl: SANDBOX,
      receivers: { paypal: "pp@sandbox.test", venmo: "vm@sandbox.test" },
    });
    const receivers = new Set(batches[0].items.map((i) => `${i.recipient_wallet}:${i.receiver}`));
    expect(receivers).toEqual(new Set(["PAYPAL:pp@sandbox.test", "VENMO:vm@sandbox.test"]));
  });

  it("marks the batch failed when PayPal refuses it, and lets the manager try again", async () => {
    const d = readyNight();
    const broken = createPayPalClient({
      baseUrl: SANDBOX,
      clientId: "id",
      clientSecret: "s",
      fetch: (async (input: RequestInfo | URL) =>
        String(input).endsWith("/oauth2/token")
          ? Response.json({ access_token: "t", expires_in: 32400 })
          : Response.json({ name: "INSUFFICIENT_FUNDS", message: "Sender has insufficient funds" }, { status: 422 })) as typeof fetch,
    });
    await expect(payNight(d, SATURDAY, broken, { baseUrl: SANDBOX })).rejects.toThrow("insufficient funds");
    expect(getNightPayout(d, SATURDAY)?.status).toBe("FAILED");

    const { client } = fakeSandbox();
    const retry = await payNight(d, SATURDAY, client, { baseUrl: SANDBOX });
    expect(retry.id).toBe(`${SATURDAY}-2`);
  });
});

describe("payout status", () => {
  it("shows unclaimed payouts from the batch read", async () => {
    const d = readyNight();
    const { client } = fakeSandbox("UNCLAIMED");
    await payNight(d, SATURDAY, client, { baseUrl: SANDBOX });
    const payout = await refreshPayout(d, SATURDAY, client);
    expect(new Set(payout?.items.map((i) => i.status))).toEqual(new Set(["UNCLAIMED"]));
  });

  it("applies item and batch webhooks to the right rows", async () => {
    const d = readyNight();
    const { client } = fakeSandbox("PENDING");
    const payout = await payNight(d, SATURDAY, client, { baseUrl: SANDBOX });
    const maria = payout.items.find((i) => i.staffId === "maria")!;

    expect(
      applyPayoutEvent(d, {
        event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        resource: { payout_item_id: "ITEM-new", transaction_status: "SUCCESS", payout_item: { sender_item_id: maria.id } },
      }),
    ).toBe(true);
    expect(getNightPayout(d, SATURDAY)?.items.find((i) => i.staffId === "maria")?.status).toBe("SUCCESS");

    expect(
      applyPayoutEvent(d, {
        event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS",
        resource: { batch_header: { payout_batch_id: "PB1", batch_status: "SUCCESS" } },
      }),
    ).toBe(true);
    expect(
      applyPayoutEvent(d, {
        event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        resource: { payout_item_id: "nope", transaction_status: "SUCCESS" },
      }),
    ).toBe(false);
    expect(applyPayoutEvent(d, { event_type: "CHECKOUT.ORDER.APPROVED" })).toBe(false);
  });
});
