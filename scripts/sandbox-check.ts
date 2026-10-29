// Sends $1.00 to one Venmo and one PayPal sandbox receiver, then waits for the result.
// npm run sandbox:check -- --venmo <sandbox email or @handle> --paypal <sandbox email>
// The sandbox rejects the PHONE recipient type, so test Venmo with an email or handle.

import { parseArgs } from "node:util";
import { type PayoutLine, getPayoutBatch, createPayoutBatch, paypal } from "@/lib/paypal";
import { settings } from "@/lib/settings";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Keys can also come from the shell.
}

const { values } = parseArgs({ options: { venmo: { type: "string" }, paypal: { type: "string" } } });
if (!values.venmo && !values.paypal) {
  console.error("Give at least one receiver: --venmo <sandbox email or @handle> and/or --paypal <sandbox email>");
  process.exit(2);
}

if (settings().paypalMode === "replay") {
  console.error("PayPal keys are not set. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.local.");
  process.exit(2);
}

const base = settings().PAYPAL_API_BASE;
if (!base.includes("sandbox")) {
  console.error(`Refusing to send money: PAYPAL_API_BASE is ${base}, not the sandbox.`);
  process.exit(2);
}

async function main() {
  const client = paypal();
  const runId = `check-${Date.now()}`;
  const lines: PayoutLine[] = [];
  if (values.venmo) lines.push({ id: `${runId}-venmo`, wallet: "VENMO", receiver: values.venmo, cents: 100, note: "Sidework sandbox check" });
  if (values.paypal) lines.push({ id: `${runId}-paypal`, wallet: "PAYPAL", receiver: values.paypal, cents: 100, note: "Sidework sandbox check" });

  await client.accessToken();
  console.log(`Signed in to ${base}`);

  const created = await createPayoutBatch(client, runId, lines, "Sidework sandbox check");
  console.log(`Batch ${created.batchId} is ${created.status}`);

  const FINAL_BATCH = new Set(["SUCCESS", "DENIED", "CANCELED"]);
  const deadline = Date.now() + 90_000;
  let batch = created;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    batch = await getPayoutBatch(client, created.batchId);
    const stillPending = batch.items.some((i) => i.status === "PENDING" || i.status === "ONHOLD");
    console.log(`  ${batch.status}: ${batch.items.map((i) => `${i.wallet} ${i.status}`).join(", ") || "no items yet"}`);
    if (FINAL_BATCH.has(batch.status) && !stillPending) break;
  }

  for (const i of batch.items) {
    console.log(`${i.wallet.padEnd(6)} ${i.status.padEnd(9)} item ${i.itemId}${i.error ? `  ${i.error}` : ""}`);
  }
  const ok = batch.items.length === lines.length && batch.items.every((i) => i.status === "SUCCESS");
  console.log(ok ? "PASS: every payout reached SUCCESS." : "FAIL: not every payout reached SUCCESS.");
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
