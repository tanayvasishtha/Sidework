import { describe, expect, it } from "vitest";
import { PayPalError, createPayPalClient } from "./client";
import { centsToValue, valueToCents } from "./money";
import { createPayoutBatch, getPayoutBatch, payoutBatchBody, recipientType } from "./payouts";

type Call = { url: string; init: RequestInit };

function fakePayPal(handler: (url: URL, init: RequestInit, calls: Call[]) => Response | undefined) {
  const calls: Call[] = [];
  let tokens = 0;
  const fakeFetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });
    if (url.pathname === "/v1/oauth2/token") {
      tokens += 1;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 32400 });
    }
    return handler(url, init, calls) ?? new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fakeFetch, tokenCount: () => tokens };
}

function client(fakeFetch: typeof fetch, now = () => 0) {
  return createPayPalClient({
    baseUrl: "https://api-m.sandbox.paypal.com/",
    clientId: "id",
    clientSecret: "secret",
    fetch: fakeFetch,
    now,
  });
}

async function rejection(p: Promise<unknown>): Promise<PayPalError> {
  return p.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (e: PayPalError) => e,
  );
}

const auth = (c: Call) => (c.init.headers as Record<string, string>).Authorization;

describe("money", () => {
  it("turns cents into PayPal strings and back", () => {
    expect(centsToValue(8405)).toBe("84.05");
    expect(centsToValue(7)).toBe("0.07");
    expect(valueToCents("84.05")).toBe(8405);
    expect(valueToCents("12.5")).toBe(1250);
    expect(valueToCents("3")).toBe(300);
  });

  it("refuses fractions of a cent", () => {
    expect(() => centsToValue(10.5)).toThrow();
    expect(() => valueToCents("1.234")).toThrow();
  });
});

describe("PayPal client", () => {
  it("signs in with client credentials and reuses the token", async () => {
    const { calls, fakeFetch, tokenCount } = fakePayPal(() => Response.json({ ok: true }));
    const c = client(fakeFetch);
    await Promise.all([c.request("GET", "/v1/a"), c.request("GET", "/v1/b")]);
    await c.request("GET", "/v1/c");

    expect(tokenCount()).toBe(1);
    const tokenCall = calls.find((x) => x.url.endsWith("/v1/oauth2/token"))!;
    expect(auth(tokenCall)).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(tokenCall.init.body).toBe("grant_type=client_credentials");
    expect(auth(calls.at(-1)!)).toBe("Bearer token-1");
  });

  it("gets a new token once the old one is about to expire", async () => {
    let t = 0;
    const { fakeFetch, tokenCount } = fakePayPal(() => Response.json({}));
    const c = client(fakeFetch, () => t);
    await c.request("GET", "/v1/a");
    t = 32400 * 1000 - 30_000;
    await c.request("GET", "/v1/a");
    expect(tokenCount()).toBe(2);
  });

  it("retries once with a fresh token after a 401", async () => {
    let first = true;
    const { calls, fakeFetch, tokenCount } = fakePayPal(() => {
      if (first) {
        first = false;
        return new Response("", { status: 401 });
      }
      return Response.json({ ok: true });
    });
    await expect(client(fakeFetch).request("GET", "/v1/a")).resolves.toEqual({ ok: true });
    expect(tokenCount()).toBe(2);
    expect(auth(calls.at(-1)!)).toBe("Bearer token-2");
  });

  it("raises PayPal's error name, issue and debug id", async () => {
    const { fakeFetch } = fakePayPal(() =>
      Response.json(
        {
          name: "VALIDATION_ERROR",
          message: "Invalid request",
          debug_id: "abc123",
          details: [{ field: "items[0].receiver", issue: "INVALID_RECEIVER" }],
        },
        { status: 400 },
      ),
    );
    const err = await rejection(client(fakeFetch).request("POST", "/v1/payments/payouts", { body: {} }));
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(400);
    expect(err.issue).toBe("VALIDATION_ERROR");
    expect(err.debugId).toBe("abc123");
    expect(err.message).toContain("INVALID_RECEIVER at items[0].receiver");
  });

  it("names the host and cause when PayPal can't be reached", async () => {
    const fakeFetch = (async () => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
    }) as typeof fetch;
    const err = await rejection(client(fakeFetch).request("GET", "/v1/a"));
    expect(err.issue).toBe("NETWORK_ERROR");
    expect(err.message).toBe("Couldn't reach PayPal at https://api-m.sandbox.paypal.com: ECONNRESET");
  });

  it("explains a failed sign-in in terms of the env vars", async () => {
    const fakeFetch = (async () =>
      Response.json({ error: "invalid_client", error_description: "Client Authentication failed" }, { status: 401 })) as typeof fetch;
    await expect(client(fakeFetch).request("GET", "/v1/a")).rejects.toThrow("PAYPAL_CLIENT_ID");
  });
});

describe("payouts", () => {
  it("works out how to address each receiver", () => {
    expect(recipientType("maria@sidework.test", "VENMO")).toBe("EMAIL");
    expect(recipientType("(415) 555-0134", "VENMO")).toBe("PHONE");
    expect(recipientType("+1 415 555 0134", "PAYPAL")).toBe("PHONE");
    expect(recipientType("@maria-lopez", "VENMO")).toBe("USER_HANDLE");
    expect(() => recipientType("@maria-lopez", "PAYPAL")).toThrow("Venmo @handle");
  });

  it("builds one item per person with wallet, note and our id", () => {
    const body = payoutBatchBody(
      "night-2026-11-08",
      [
        { id: "maria", wallet: "VENMO", receiver: "+1 (415) 555-0134", cents: 8405, note: "Tips, Sat Nov 8" },
        { id: "omar", wallet: "PAYPAL", receiver: "omar@sidework.test", cents: 9120, note: "Tips, Sat Nov 8" },
      ],
      "Your tips from Lucia's",
    );
    expect(body.sender_batch_header).toEqual({ sender_batch_id: "night-2026-11-08", email_subject: "Your tips from Lucia's" });
    expect(body.items[0]).toEqual({
      recipient_type: "PHONE",
      recipient_wallet: "VENMO",
      receiver: "4155550134",
      amount: { currency: "USD", value: "84.05" },
      note: "Tips, Sat Nov 8",
      sender_item_id: "maria",
    });
    expect(body.items[1].recipient_type).toBe("EMAIL");
  });

  it("refuses empty, zero and duplicate lines", () => {
    const line = { id: "a", wallet: "PAYPAL" as const, receiver: "a@x.test", cents: 100, note: "n" };
    expect(() => payoutBatchBody("b", [], "s")).toThrow("at least one");
    expect(() => payoutBatchBody("b", [{ ...line, cents: 0 }], "s")).toThrow("more than $0.00");
    expect(() => payoutBatchBody("b", [line, line], "s")).toThrow("twice");
  });

  it("sends the batch id as the request id and reads item statuses back", async () => {
    const { calls, fakeFetch } = fakePayPal((url, init) => {
      if (init.method === "POST" && url.pathname === "/v1/payments/payouts") {
        return Response.json(
          { batch_header: { payout_batch_id: "PB1", batch_status: "PENDING" } },
          { status: 201 },
        );
      }
      if (url.pathname === "/v1/payments/payouts/PB1") {
        return Response.json({
          batch_header: { payout_batch_id: "PB1", batch_status: "SUCCESS" },
          items: [
            {
              payout_item_id: "I1",
              transaction_status: "SUCCESS",
              payout_item: { sender_item_id: "maria", recipient_wallet: "VENMO", amount: { currency: "USD", value: "84.05" } },
            },
            {
              payout_item_id: "I2",
              transaction_status: "UNCLAIMED",
              payout_item: { sender_item_id: "omar", amount: { currency: "USD", value: "91.20" } },
              errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" },
            },
          ],
        });
      }
    });
    const c = client(fakeFetch);
    const created = await createPayoutBatch(c, "night-1", [
      { id: "maria", wallet: "VENMO", receiver: "maria@sidework.test", cents: 8405, note: "Tips" },
    ]);
    expect(created).toEqual({ batchId: "PB1", status: "PENDING", items: [] });
    const post = calls.find((x) => x.url.endsWith("/v1/payments/payouts"))!;
    expect((post.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("night-1");

    const batch = await getPayoutBatch(c, "PB1");
    expect(batch.status).toBe("SUCCESS");
    expect(batch.items).toEqual([
      { itemId: "I1", lineId: "maria", status: "SUCCESS", wallet: "VENMO", cents: 8405, error: undefined },
      { itemId: "I2", lineId: "omar", status: "UNCLAIMED", wallet: "PAYPAL", cents: 9120, error: "Receiver is unregistered" },
    ]);
  });
});
