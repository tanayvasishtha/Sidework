import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPayPalClient } from "@/lib/paypal/client";
import { ReplayMissError, type Recording, replayFetch, requestKey } from "./replay";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "sidework-replay-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function countingFetch(reply: () => Response) {
  let calls = 0;
  const f = (async () => {
    calls += 1;
    return reply();
  }) as unknown as typeof fetch;
  return { f, calls: () => calls };
}

describe("replay", () => {
  it("records a live call and answers the same request offline", async () => {
    const dir = tempDir();
    const live = countingFetch(() => Response.json({ id: "PB1", status: "SUCCESS" }, { status: 201 }));
    const recorder = replayFetch({ mode: "record", dir, fetch: live.f });
    const recorded = await recorder("https://api.test/v1/payouts", { method: "POST", body: JSON.stringify({ b: 2, a: 1 }) });
    expect(await recorded.json()).toEqual({ id: "PB1", status: "SUCCESS" });

    const offline = replayFetch({ mode: "replay", dir, fetch: live.f });
    // Same body with keys in another order still finds the recording.
    const replayed = await offline("https://api.test/v1/payouts", { method: "POST", body: JSON.stringify({ a: 1, b: 2 }) });
    expect(replayed.status).toBe(201);
    expect(await replayed.json()).toEqual({ id: "PB1", status: "SUCCESS" });
    expect(live.calls()).toBe(1);
  });

  it("never writes tokens or headers to disk", async () => {
    const dir = tempDir();
    const live = countingFetch(() => Response.json({ access_token: "A21AAsecret", expires_in: 32400 }));
    const recorder = replayFetch({ mode: "record", dir, fetch: live.f });
    const res = await recorder("https://api.test/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: "Basic c2VjcmV0" },
      body: "grant_type=client_credentials",
    });
    expect((await res.json()).access_token).toBe("A21AAsecret");

    const [file] = readdirSync(dir);
    const text = readFileSync(join(dir, file), "utf8");
    expect(text).not.toContain("A21AAsecret");
    expect(text).not.toContain("c2VjcmV0");
    expect((JSON.parse(text) as Recording).response.body).toContain('"access_token": "redacted"');
  });

  it("doesn't keep a failed response as a recording", async () => {
    const dir = tempDir();
    const live = countingFetch(() => Response.json({ name: "INTERNAL_SERVICE_ERROR" }, { status: 500 }));
    const res = await replayFetch({ mode: "record", dir, fetch: live.f })("https://api.test/v1/x", { method: "GET" });
    expect(res.status).toBe(500);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("says how to record a missing response", async () => {
    const offline = replayFetch({ mode: "replay", dir: tempDir() });
    await expect(offline("https://api.test/v1/x", { method: "GET" })).rejects.toBeInstanceOf(ReplayMissError);
    await expect(offline("https://api.test/v1/x", { method: "GET" })).rejects.toThrow("REPLAY=record");
  });

  it("passes live calls straight through", () => {
    const live = countingFetch(() => new Response("ok"));
    expect(replayFetch({ mode: "live", dir: "unused", fetch: live.f })).toBe(live.f);
  });

  it("keys on method, url and body only", () => {
    expect(requestKey("get", "https://a", null)).toBe(requestKey("GET", "https://a", null));
    expect(requestKey("GET", "https://a", null)).not.toBe(requestKey("GET", "https://b", null));
  });

  it("runs the PayPal client end to end from recordings", async () => {
    const dir = tempDir();
    const live = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/v1/oauth2/token")
        ? Response.json({ access_token: "real", expires_in: 32400 })
        : Response.json({ batch_header: { payout_batch_id: "PB9", batch_status: "SUCCESS" } })) as typeof fetch;
    const base = "https://api-m.sandbox.paypal.com";
    const recordClient = createPayPalClient({ baseUrl: base, clientId: "id", clientSecret: "s", fetch: replayFetch({ mode: "record", dir, fetch: live }) });
    await recordClient.request("GET", "/v1/payments/payouts/PB9");

    const judge = createPayPalClient({ baseUrl: base, clientId: "replay", clientSecret: "replay", fetch: replayFetch({ mode: "replay", dir }) });
    await expect(judge.request("GET", "/v1/payments/payouts/PB9")).resolves.toMatchObject({
      batch_header: { payout_batch_id: "PB9" },
    });
  });
});

describe("replay through the PayPal client", () => {
  it("surfaces a replay miss as itself, not as a network failure", async () => {
    const judge = createPayPalClient({
      baseUrl: "https://api-m.sandbox.paypal.com",
      clientId: "replay",
      clientSecret: "replay",
      fetch: replayFetch({ mode: "replay", dir: tempDir() }),
    });
    await expect(judge.request("GET", "/v1/payments/payouts/PB1")).rejects.toBeInstanceOf(ReplayMissError);
  });
});
