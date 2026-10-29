import type { DatabaseSync } from "node:sqlite";
import { getCloseout } from "@/lib/closeout";
import { night as nightName } from "@/lib/format";
import {
  type BatchStatus,
  createPayoutBatch,
  getPayoutBatch,
  type ItemStatus,
  type PayPalClient,
  type PayoutLine,
  type Wallet,
} from "@/lib/paypal";

export type PayoutRow = {
  id: string;
  staffId: string;
  name: string;
  wallet: Wallet;
  cents: number;
  status: ItemStatus;
  error: string | null;
};

export type NightPayout = {
  id: string;
  paypalBatchId: string | null;
  status: BatchStatus | "SENDING" | "FAILED";
  createdAt: string;
  items: PayoutRow[];
};

/** Payment was refused before any money moved. The message is for the manager. */
export class PayRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayRefusedError";
  }
}

const SETTLED: ReadonlySet<ItemStatus> = new Set(["SUCCESS", "FAILED", "UNCLAIMED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]);

export function isSettled(status: ItemStatus): boolean {
  return SETTLED.has(status);
}

export function getNightPayout(d: DatabaseSync, nightId: string): NightPayout | null {
  const batch = d
    .prepare("select id, paypal_batch_id, status, created_at from payout_batches where night_id = ? order by created_at desc, id desc limit 1")
    .get(nightId) as { id: string; paypal_batch_id: string | null; status: NightPayout["status"]; created_at: string } | undefined;
  if (!batch) return null;
  const items = d
    .prepare(
      `select i.id, i.staff_id, s.name, i.wallet, i.amount_cents, i.status, i.error
       from payout_items i join staff s on s.id = i.staff_id where i.batch_id = ? order by i.amount_cents desc, s.name`,
    )
    .all(batch.id) as { id: string; staff_id: string; name: string; wallet: Wallet; amount_cents: number; status: ItemStatus; error: string | null }[];
  return {
    id: batch.id,
    paypalBatchId: batch.paypal_batch_id,
    status: batch.status,
    createdAt: batch.created_at,
    items: items.map((i) => ({
      id: i.id,
      staffId: i.staff_id,
      name: i.name,
      wallet: i.wallet,
      cents: i.amount_cents,
      status: i.status,
      error: i.error,
    })),
  };
}

/**
 * Pays tonight's pool through PayPal Payouts, one item per person, Venmo or PayPal.
 * Refuses unless the rules engine is satisfied, and pays a night only once.
 */
export async function payNight(
  d: DatabaseSync,
  nightId: string,
  client: PayPalClient,
  opts: { baseUrl: string; receivers?: { paypal?: string; venmo?: string }; now?: () => Date },
): Promise<NightPayout> {
  if (!opts.baseUrl.includes("sandbox")) {
    throw new PayRefusedError("Sidework only sends money from the PayPal sandbox.");
  }
  const existing = getNightPayout(d, nightId);
  if (existing && existing.status !== "FAILED" && existing.status !== "DENIED" && existing.status !== "CANCELED") {
    throw new PayRefusedError("Tonight's tips have already been sent.");
  }
  const c = getCloseout(d, nightId);
  if (c.blocking > 0) {
    throw new PayRefusedError(`Fix ${c.blocking === 1 ? "the problem" : `the ${c.blocking} problems`} in the pool first.`);
  }
  const shares = c.split.filter((s) => s.cents > 0);
  if (shares.length === 0) throw new PayRefusedError("There's nothing to pay out tonight.");

  const now = (opts.now ?? (() => new Date()))();
  const attempt = (d.prepare("select count(*) as n from payout_batches where night_id = ?").get(nightId) as { n: number }).n + 1;
  const batchId = `${nightId}-${attempt}`;
  const staff = new Map(c.people.map((p) => [p.id, p]));
  const lines: PayoutLine[] = shares.map((s) => {
    const person = staff.get(s.staffId);
    const stand = s.wallet === "VENMO" ? opts.receivers?.venmo : opts.receivers?.paypal;
    return {
      id: `${batchId}:${s.staffId}`,
      wallet: s.wallet,
      receiver: stand ?? person?.payoutReceiver ?? "",
      cents: s.cents,
      note: `Your tips from ${c.restaurant.name}, ${nightName(c.night.date)}`,
    };
  });

  // Recorded before the call, so a second click finds a batch already on its way.
  const stamp = now.toISOString();
  d.exec("begin");
  try {
    d.prepare("insert into payout_batches (id, night_id, status, created_at, updated_at) values (?, ?, 'SENDING', ?, ?)").run(
      batchId,
      nightId,
      stamp,
      stamp,
    );
    const add = d.prepare(
      "insert into payout_items (id, batch_id, staff_id, wallet, receiver, amount_cents, status, updated_at) values (?, ?, ?, ?, ?, ?, 'PENDING', ?)",
    );
    for (const [i, l] of lines.entries()) add.run(l.id, batchId, shares[i].staffId, l.wallet, l.receiver, l.cents, stamp);
    d.exec("commit");
  } catch (err) {
    d.exec("rollback");
    throw err;
  }

  try {
    const senderBatchId = `sidework-${batchId}-${now.getTime().toString(36)}`;
    const created = await createPayoutBatch(client, senderBatchId, lines, `Your tips from ${c.restaurant.name}`);
    d.prepare("update payout_batches set paypal_batch_id = ?, status = ?, updated_at = ? where id = ?").run(
      created.batchId,
      created.status,
      new Date().toISOString(),
      batchId,
    );
    d.prepare("update nights set status = 'paid' where id = ?").run(nightId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    d.prepare("update payout_batches set status = 'FAILED', updated_at = ? where id = ?").run(new Date().toISOString(), batchId);
    d.prepare("update payout_items set status = 'FAILED', error = ? where batch_id = ?").run(message, batchId);
    throw err;
  }

  // Item ids come from a follow-up read. If it fails, webhooks or the next refresh fill them in.
  await refreshPayout(d, nightId, client).catch(() => undefined);
  return getNightPayout(d, nightId)!;
}

/** Reads the batch back from PayPal and updates each person's status. */
export async function refreshPayout(d: DatabaseSync, nightId: string, client: PayPalClient): Promise<NightPayout | null> {
  const payout = getNightPayout(d, nightId);
  if (!payout?.paypalBatchId) return payout;
  const batch = await getPayoutBatch(client, payout.paypalBatchId);
  const stamp = new Date().toISOString();
  const update = d.prepare(
    "update payout_items set status = ?, paypal_item_id = coalesce(?, paypal_item_id), error = ?, updated_at = ? where id = ? and batch_id = ?",
  );
  for (const item of batch.items) update.run(item.status, item.itemId, item.error ?? null, stamp, item.lineId, payout.id);
  d.prepare("update payout_batches set status = ?, updated_at = ? where id = ?").run(batch.status, stamp, payout.id);
  return getNightPayout(d, nightId);
}

type WebhookEvent = {
  event_type?: string;
  resource?: {
    payout_item_id?: string;
    transaction_status?: ItemStatus;
    payout_item?: { sender_item_id?: string };
    errors?: { name?: string; message?: string };
    batch_header?: { payout_batch_id?: string; batch_status?: BatchStatus };
  };
};

/** Applies a verified PayPal webhook. Returns false for events about payouts we don't know. */
export function applyPayoutEvent(d: DatabaseSync, event: WebhookEvent): boolean {
  const type = event.event_type ?? "";
  const r = event.resource ?? {};
  const stamp = new Date().toISOString();

  if (type.startsWith("PAYMENT.PAYOUTS-ITEM.") && r.transaction_status) {
    const res = d
      .prepare(
        "update payout_items set status = ?, paypal_item_id = coalesce(paypal_item_id, ?), error = ?, updated_at = ? where paypal_item_id = ? or id = ?",
      )
      .run(
        r.transaction_status,
        r.payout_item_id ?? null,
        r.errors?.message ?? r.errors?.name ?? null,
        stamp,
        r.payout_item_id ?? "",
        r.payout_item?.sender_item_id ?? "",
      );
    return Number(res.changes) > 0;
  }

  if (type.startsWith("PAYMENT.PAYOUTSBATCH.") && r.batch_header?.payout_batch_id && r.batch_header.batch_status) {
    const res = d
      .prepare("update payout_batches set status = ?, updated_at = ? where paypal_batch_id = ?")
      .run(r.batch_header.batch_status, stamp, r.batch_header.payout_batch_id);
    return Number(res.changes) > 0;
  }

  return false;
}
