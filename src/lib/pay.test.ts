import { describe, expect, it } from "vitest";
import { acceptEngineSplit, getCloseout, saveShiftEdits, saveSplitCheck, takeOut } from "@/lib/closeout";
import { openDb, SATURDAY } from "@/lib/db";
import { createPayPalClient } from "@/lib/paypal";
import {
  applyPayoutEvent,
  getNightPayout,
  payoutStands,
  PayRefusedError,
  PayUncertainError,
  payNight,
  refreshPayout,
  walletSent,
} from "./pay";

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
  saveSplitCheck(d, SATURDAY, getCloseout(d, SATURDAY).splitKey, "match", []);
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
    // Maria chose Venmo, which PayPal's sandbox can't pay, so she's paid to PayPal there.
    expect(sent.items.find((i) => i.sender_item_id.endsWith(":maria"))).toMatchObject({
      recipient_wallet: "PAYPAL",
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

  it("won't pay a split nobody checked", async () => {
    const d = openDb(":memory:");
    takeOut(d, SATURDAY, "dave", "FLSA-MGR");
    const { client, batches } = fakeSandbox();
    await expect(payNight(d, SATURDAY, client, { baseUrl: SANDBOX })).rejects.toThrow("Check the split");
    expect(batches).toHaveLength(0);
  });

  it("holds a disagreement until a person chooses the engine's numbers", async () => {
    const d = openDb(":memory:");
    takeOut(d, SATURDAY, "dave", "FLSA-MGR");
    saveSplitCheck(d, SATURDAY, getCloseout(d, SATURDAY).splitKey, "mismatch", [
      { staffId: "jake", name: "Jake Park", proposedCents: 100, checkedCents: 200 },
    ]);
    const { client, batches } = fakeSandbox();
    await expect(payNight(d, SATURDAY, client, { baseUrl: SANDBOX })).rejects.toThrow("disagree");
    expect(batches).toHaveLength(0);

    acceptEngineSplit(d, SATURDAY);
    await payNight(d, SATURDAY, client, { baseUrl: SANDBOX });
    expect(batches).toHaveLength(1);
  });

  it("refuses anything but the sandbox", async () => {
    const { client } = fakeSandbox();
    await expect(payNight(readyNight(), SATURDAY, client, { baseUrl: "https://api-m.paypal.com" })).rejects.toThrow("sandbox");
  });

  it("sends test payouts to the stand-in sandbox account when set", async () => {
    const { client, batches } = fakeSandbox();
    await payNight(readyNight(), SATURDAY, client, { baseUrl: SANDBOX, sandboxReceiver: "pp@sandbox.test" });
    const receivers = new Set(batches[0].items.map((i) => `${i.recipient_wallet}:${i.receiver}`));
    expect(receivers).toEqual(new Set(["PAYPAL:pp@sandbox.test"]));
  });

  it("keeps Venmo for live accounts and swaps it only in the sandbox", () => {
    expect(walletSent("VENMO", SANDBOX)).toBe("PAYPAL");
    expect(walletSent("VENMO", "https://api-m.paypal.com")).toBe("VENMO");
    expect(walletSent("PAYPAL", SANDBOX)).toBe("PAYPAL");
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

describe("when PayPal's answer is lost", () => {
  /** PayPal takes the batch, then the connection drops before the reply. Repeats of a request id are deduped. */
  function droppingSandbox() {
    const accepted = new Map<string, Sent>();
    let drop = true;
    const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "t", expires_in: 32400 });
      if (init.method === "POST") {
        const requestId = (init.headers as Record<string, string>)["PayPal-Request-Id"];
        if (!accepted.has(requestId)) accepted.set(requestId, JSON.parse(String(init.body)) as Sent);
        if (drop) {
          drop = false;
          throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
        }
        return Response.json({ batch_header: { payout_batch_id: "PB1", batch_status: "PENDING" } }, { status: 201 });
      }
      return Response.json({ batch_header: { payout_batch_id: "PB1", batch_status: "SUCCESS" }, items: [] });
    }) as typeof fetch;
    return { accepted, client: createPayPalClient({ baseUrl: SANDBOX, clientId: "id", clientSecret: "s", fetch: f }) };
  }

  it("never sends a second batch on retry", async () => {
    const d = readyNight();
    const { client, accepted } = droppingSandbox();

    await expect(payNight(d, SATURDAY, client, { baseUrl: SANDBOX })).rejects.toThrow(PayUncertainError);
    expect(getNightPayout(d, SATURDAY)?.status).toBe("UNCERTAIN");
    expect(getCloseout(d, SATURDAY).locked).toBe(true);

    const payout = await payNight(d, SATURDAY, client, { baseUrl: SANDBOX });
    expect(accepted.size).toBe(1);
    expect(payout.id).toBe(`${SATURDAY}-1`);
    expect(payout.paypalBatchId).toBe("PB1");
  });

  it("treats a batch stuck in SENDING the same way once it has gone stale", async () => {
    const d = readyNight();
    const { client, batches } = fakeSandbox();
    d.prepare("insert into payout_batches (id, night_id, sender_batch_id, status, created_at, updated_at) values ('b', ?, 'sender-b', 'SENDING', ?, ?)").run(
      SATURDAY,
      "2026-11-07T06:00:00.000Z",
      "2026-11-07T06:00:00.000Z",
    );
    d.prepare(
      "insert into payout_items (id, batch_id, staff_id, wallet, receiver, amount_cents, status, updated_at) values ('b:maria', 'b', 'maria', 'VENMO', 'maria@sidework.test', 100, 'PENDING', 'x')",
    ).run();

    const soon = () => new Date("2026-11-07T06:00:30.000Z");
    await expect(payNight(d, SATURDAY, client, { baseUrl: SANDBOX, now: soon })).rejects.toThrow("on their way");

    const later = () => new Date("2026-11-07T06:10:00.000Z");
    const payout = await payNight(d, SATURDAY, client, { baseUrl: SANDBOX, now: later });
    expect(batches[0].sender_batch_header.sender_batch_id).toBe("sender-b");
    expect(payout.id).toBe("b");
  });
});

describe("after payment", () => {
  it("locks the night against notes and pool changes", async () => {
    const d = readyNight();
    await payNight(d, SATURDAY, fakeSandbox().client, { baseUrl: SANDBOX });
    expect(() => saveShiftEdits(d, SATURDAY, "note", { shifts: [], applied: [], rejected: [] })).toThrow("can't change");
    expect(() => takeOut(d, SATURDAY, "maria", "FLSA-MGR")).toThrow("can't change");
  });

  it("reopens the night when PayPal denies the batch later", async () => {
    const d = readyNight();
    await payNight(d, SATURDAY, fakeSandbox("PENDING").client, { baseUrl: SANDBOX });

    applyPayoutEvent(d, {
      event_type: "PAYMENT.PAYOUTSBATCH.DENIED",
      resource: { batch_header: { payout_batch_id: "PB1", batch_status: "DENIED" } },
    });

    const c = getCloseout(d, SATURDAY);
    expect(c.locked).toBe(false);
    expect(c.night.status).toBe("open");
    const saved = d.prepare("select count(*) as n from allocations where night_id = ?").get(SATURDAY) as { n: number };
    expect(saved.n).toBe(0);
    expect(payoutStands(getNightPayout(d, SATURDAY))).toBe(false);
  });

  it("doesn't let an old webhook undo a finished payout", async () => {
    const d = readyNight();
    const payout = await payNight(d, SATURDAY, fakeSandbox().client, { baseUrl: SANDBOX });
    const maria = payout.items.find((i) => i.staffId === "maria")!;
    applyPayoutEvent(d, {
      event_type: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
      resource: { transaction_status: "UNCLAIMED", payout_item: { sender_item_id: maria.id } },
    });
    expect(getNightPayout(d, SATURDAY)?.items.find((i) => i.staffId === "maria")?.status).toBe("SUCCESS");
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
